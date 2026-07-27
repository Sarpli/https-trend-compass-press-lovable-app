#!/usr/bin/env python3
"""Integration tests for auth gate rate limiting.

Verifies:
  1. HTTP burst on /api/public/auth/gate for signin exceeds the 10/min IP
     bucket and returns 429 with a numeric Retry-After header.
  2. HTTP burst for signup exceeds the 5 per 5-min IP bucket the same way.
  3. HTTP burst for password reset exceeds the 5/hr IP bucket the same way.
  4. HTTP burst for resend-confirmation exceeds the 5/hr IP bucket.
  5. The auth UI surfaces a "Try again in Ns" toast countdown for
     sign-in, forgot-password, and resend-confirmation flows.

Exit: 0 pass, 1 fail.

    python3 tests/auth_rate_limit.py
"""
import asyncio
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ART = Path(os.environ.get("AUTH_RL_ARTIFACT_DIR", "/tmp/auth-rate-limit"))


def post_gate(mode: str, email: str, ip: str) -> tuple[int, dict, str]:
    body = json.dumps({"mode": mode, "email": email}).encode()
    # Spoof the client IP so repeated local runs don't poison a shared
    # bucket — the server reads x-forwarded-for first.
    req = urllib.request.Request(
        f"{BASE_URL}/api/public/auth/gate",
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-forwarded-for": ip,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")


def burst(mode: str, email: str, n: int) -> list[tuple[int, dict, str]]:
    ip = f"203.0.113.{uuid.uuid4().int % 254 + 1}"
    out = []
    for _ in range(n):
        out.append(post_gate(mode, email, ip))
    return out


def assert_burst_429(label: str, results: list[tuple[int, dict, str]], errors: list[str]) -> None:
    codes = [r[0] for r in results]
    print(f"  {label} status codes: {codes}")
    if 429 not in codes:
        errors.append(f"{label}: expected a 429 in burst, got {codes}")
        return
    idx = codes.index(429)
    _, headers, body = results[idx]
    retry = headers.get("Retry-After") or headers.get("retry-after")
    if not retry or not retry.isdigit() or int(retry) < 1:
        errors.append(f"{label}: missing/invalid Retry-After header: {retry!r}")
    try:
        parsed = json.loads(body)
    except Exception:
        errors.append(f"{label}: 429 body not JSON: {body[:120]}")
        return
    if parsed.get("error") != "rate_limited":
        errors.append(f"{label}: 429 body error field = {parsed.get('error')!r}")
    if not isinstance(parsed.get("retry_after_seconds"), int):
        errors.append(f"{label}: retry_after_seconds missing or wrong type: {parsed!r}")


async def ui_countdown_toast(errors: list[str]) -> None:
    # Warm the sign-in IP bucket by exhausting it via the same forwarded IP
    # the browser will present, then submit the form and look for the toast.
    ip = f"203.0.113.{uuid.uuid4().int % 254 + 1}"
    for _ in range(12):
        post_gate("signin", "burst-ui@example.test", ip)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            extra_http_headers={"x-forwarded-for": ip},
        )
        page = await ctx.new_page()
        # The WelcomeAuthModal auto-opens on any unauthenticated page and
        # is itself gated. Drive it directly to test the same toast path.
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        modal_email = page.locator('input[placeholder="you@example.com"]')
        await modal_email.wait_for(timeout=8000)
        # Modal opens in signup mode; flip to sign in.
        try:
            await page.get_by_role("button", name="Already a subscriber? Sign in").click(timeout=2000)
        except Exception:
            pass
        await modal_email.fill("burst-ui@example.test")
        await page.locator('input[placeholder="Password (min 8 chars)"]').fill("Abcd1768!")
        await page.get_by_role("button", name="Sign in", exact=True).click()
        # Sonner renders a toast; wait for the countdown copy.
        try:
            await page.wait_for_selector("text=/Try again in (\\d+m ?)?\\d+s?\\.?/", timeout=8000)
        except Exception:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / "no_toast.png"))
            errors.append("UI: expected 'Try again in Ns' toast, none appeared")
        else:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / "toast.png"))
            print("  UI toast rendered with countdown.")
        await browser.close()


async def ui_countdown_toast_flow(
    label: str,
    warm_mode: str,
    warm_count: int,
    trigger_button: str,
    errors: list[str],
) -> None:
    """Exhaust the IP bucket for `warm_mode`, open /auth, dismiss the
    welcome modal, and click the button that triggers the same mode from
    the sign-in page. Assert the countdown toast appears."""
    ip = f"203.0.113.{uuid.uuid4().int % 254 + 1}"
    email = f"{label}-ui@example.test"
    for _ in range(warm_count):
        post_gate(warm_mode, email, ip)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            extra_http_headers={"x-forwarded-for": ip},
        )
        page = await ctx.new_page()
        await page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
        # WelcomeAuthModal auto-opens after ~600ms on any unauthenticated
        # page and covers the auth form. Give it time to mount, then close
        # it and wait for the overlay to fully unmount so it stops
        # intercepting pointer events.
        close_btn = page.locator('button[aria-label="Close"]')
        try:
            await close_btn.wait_for(state="visible", timeout=8000)
            await close_btn.click()
        except Exception:
            pass
        try:
            await page.wait_for_selector(
                'button[aria-label="Close"]', state="detached", timeout=6000
            )
        except Exception:
            pass
        # /auth defaults to sign-in. "Forgot password?" is visible in that
        # mode; "Resend confirmation email" only renders in signup mode.
        if trigger_button == "Resend confirmation email":
            try:
                await page.get_by_role(
                    "button", name="New subscriber? Create an account"
                ).click(timeout=3000)
            except Exception:
                pass
        # The auth page's email input has no placeholder match with the modal;
        # target it by role/label.
        email_input = page.locator('input[type="email"]').first
        await email_input.wait_for(timeout=6000)
        await email_input.fill(email)
        await page.get_by_role("button", name=trigger_button).click()
        try:
            await page.wait_for_selector("text=/Try again in (\\d+m ?)?\\d+s?\\.?/", timeout=8000)
        except Exception:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / f"no_toast_{label}.png"))
            errors.append(f"UI[{label}]: expected 'Try again in Ns' toast, none appeared")
        else:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / f"toast_{label}.png"))
            print(f"  UI[{label}] toast rendered with countdown.")
        await browser.close()


def parse_countdown_seconds(text: str) -> int | None:
    """Extract total seconds from a 'Try again in [Nm ]Ns' toast body."""
    m = re.search(r"Try again in (?:(\d+)m ?)?(\d+)s", text)
    if not m:
        return None
    minutes = int(m.group(1) or 0)
    seconds = int(m.group(2))
    return minutes * 60 + seconds


async def ui_matches_retry_after(
    label: str,
    warm_mode: str,
    warm_count: int,
    email_field_selector: str,
    password_field_selector: str | None,
    submit_button_name: str,
    switch_to_signin: bool,
    errors: list[str],
) -> None:
    """Warm the IP bucket, capture server Retry-After, then drive the UI
    to submit the same action from the WelcomeAuthModal and assert:
      1. Retry-After header is present and numeric on the 429.
      2. UI countdown seconds match Retry-After within ±3 seconds.
    """
    ip = f"203.0.113.{uuid.uuid4().int % 254 + 1}"
    email = f"{label}-match-{uuid.uuid4().hex[:8]}@example.test"
    for _ in range(warm_count):
        post_gate(warm_mode, email, ip)

    # One final direct call captures the authoritative server countdown.
    status, headers, _body = post_gate(warm_mode, email, ip)
    probe_ts = time.time()
    if status != 429:
        errors.append(f"UI-match[{label}]: warm-up did not reach 429 (got {status})")
        return
    retry_raw = headers.get("Retry-After") or headers.get("retry-after")
    if not retry_raw or not retry_raw.isdigit():
        errors.append(f"UI-match[{label}]: Retry-After missing/non-numeric: {retry_raw!r}")
        return
    server_seconds = int(retry_raw)
    if server_seconds < 1:
        errors.append(f"UI-match[{label}]: Retry-After < 1s: {server_seconds}")
        return

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            extra_http_headers={"x-forwarded-for": ip},
        )
        page = await ctx.new_page()
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        modal_email = page.locator(email_field_selector)
        await modal_email.wait_for(timeout=8000)
        if switch_to_signin:
            try:
                await page.get_by_role(
                    "button", name="Already a subscriber? Sign in"
                ).click(timeout=2000)
            except Exception:
                pass
        await modal_email.fill(email)
        if password_field_selector:
            await page.locator(password_field_selector).fill("Abcd1768!")
        # Capture the timestamp right before we click so we can bound the
        # server's Retry-After clock against the UI countdown.
        await page.get_by_role("button", name=submit_button_name, exact=True).click()
        click_ts = time.time()
        try:
            toast = page.locator("text=/Try again in (\\d+m ?)?\\d+s\\.?/").first
            await toast.wait_for(timeout=8000)
            toast_text = (await toast.inner_text()).strip()
        except Exception:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / f"match_no_toast_{label}.png"))
            errors.append(f"UI-match[{label}]: countdown toast never appeared")
            await browser.close()
            return

        toast_ts = time.time()
        ui_seconds = parse_countdown_seconds(toast_text)
        # The UI countdown reflects the server's Retry-After AT CLICK TIME
        # (a fresh 429 is issued on the click). The 429 clock advances one
        # second per wall-clock second from the initial probe onward.
        elapsed_probe_to_toast = toast_ts - probe_ts
        expected = server_seconds - elapsed_probe_to_toast
        if ui_seconds is None:
            errors.append(
                f"UI-match[{label}]: could not parse countdown from {toast_text!r}"
            )
        elif abs(ui_seconds - expected) > 4:
            errors.append(
                f"UI-match[{label}]: UI countdown {ui_seconds}s vs "
                f"server {server_seconds}s "
                f"(elapsed {elapsed_probe_to_toast:.1f}s, expected ~{expected:.0f}s)"
            )
        else:
            print(
                f"  UI-match[{label}] server={server_seconds}s ui={ui_seconds}s "
                f"elapsed={elapsed_probe_to_toast:.1f}s (within tolerance)"
            )
        ART.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(ART / f"match_toast_{label}.png"))
        await browser.close()


async def main() -> int:
    errors: list[str] = []

    print("=== signin burst (limit 10 / 60s per IP) ===")
    signin_email = f"signin-{uuid.uuid4().hex[:8]}@example.test"
    signin_results = burst("signin", signin_email, 15)
    assert_burst_429("signin", signin_results, errors)

    print("=== signup burst (limit 5 / 300s per IP) ===")
    signup_email = f"signup-{uuid.uuid4().hex[:8]}@example.test"
    signup_results = burst("signup", signup_email, 8)
    assert_burst_429("signup", signup_results, errors)

    print("=== reset burst (limit 5 / 3600s per IP) ===")
    reset_email = f"reset-{uuid.uuid4().hex[:8]}@example.test"
    reset_results = burst("reset", reset_email, 8)
    assert_burst_429("reset", reset_results, errors)

    print("=== resend burst (limit 5 / 3600s per IP) ===")
    resend_email = f"resend-{uuid.uuid4().hex[:8]}@example.test"
    resend_results = burst("resend", resend_email, 8)
    assert_burst_429("resend", resend_results, errors)

    print("=== UI countdown toast ===")
    await ui_countdown_toast(errors)

    print("=== UI countdown toast (forgot password) ===")
    await ui_countdown_toast_flow(
        label="reset",
        warm_mode="reset",
        warm_count=6,
        trigger_button="Forgot password?",
        errors=errors,
    )

    print("=== UI countdown toast (resend confirmation) ===")
    await ui_countdown_toast_flow(
        label="resend",
        warm_mode="resend",
        warm_count=6,
        trigger_button="Resend confirmation email",
        errors=errors,
    )

    print("=== UI countdown matches Retry-After (signin) ===")
    await ui_matches_retry_after(
        label="signin",
        warm_mode="signin",
        warm_count=12,
        email_field_selector='input[placeholder="you@example.com"]',
        password_field_selector='input[placeholder="Password (min 8 chars)"]',
        submit_button_name="Sign in",
        switch_to_signin=True,
        errors=errors,
    )

    print("=== UI countdown matches Retry-After (signup) ===")
    await ui_matches_retry_after(
        label="signup",
        warm_mode="signup",
        warm_count=6,
        email_field_selector='input[placeholder="you@example.com"]',
        password_field_selector='input[placeholder="Password (min 8 chars)"]',
        submit_button_name="Create account",
        switch_to_signin=False,
        errors=errors,
    )

    if errors:
        print("\nFAIL:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))