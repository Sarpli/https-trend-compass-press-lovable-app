#!/usr/bin/env python3
"""Integration tests for auth gate rate limiting.

Verifies:
  1. HTTP burst on /api/public/auth/gate for signin exceeds the 10/min IP
     bucket and returns 429 with a numeric Retry-After header.
  2. HTTP burst for signup exceeds the 5 per 5-min IP bucket the same way.
  3. The auth UI surfaces a "Try again in Ns" toast countdown when the
     gate blocks the request.

Exit: 0 pass, 1 fail.

    python3 tests/auth_rate_limit.py
"""
import asyncio
import json
import os
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
            await page.wait_for_selector("text=/Too many attempts\\. Try again in \\d+s\\./", timeout=8000)
        except Exception:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / "no_toast.png"))
            errors.append("UI: expected 'Try again in Ns' toast, none appeared")
        else:
            ART.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(ART / "toast.png"))
            print("  UI toast rendered with countdown.")
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

    print("=== UI countdown toast ===")
    await ui_countdown_toast(errors)

    if errors:
        print("\nFAIL:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))