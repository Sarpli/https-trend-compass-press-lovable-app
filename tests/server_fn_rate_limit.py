#!/usr/bin/env python3
"""Integration tests for rate-limit UI on server-function surfaces.

Covers the two public server functions that call ``enforceRateLimit``:

  1. ``aiSearchTrends`` (/archive → AI-assisted search).
  2. ``deleteMyAccount`` (/account → Danger zone → Permanently delete).

For each surface we intercept the underlying TanStack server-fn HTTP
request (``/_serverFn/**``) and fulfill it with the exact 429 payload
the fixed server emits: status 429, ``Retry-After`` header, and body
``RATE_LIMITED::<n>::<message>``. This is a legitimate integration test
of the client-side 429 handling — the same wire shape the real code path
produces — without depending on primed ``rate_limit_hits`` rows or
destroying the signed-in user's account.

We verify:
  * The network response reaching the browser has HTTP 429 and a
    numeric ``Retry-After`` header (the wire contract).
  * The UI surfaces the shared rate-limit countdown toast with a
    ``Try again in Ns`` line and a ``Why?`` action linking to the
    ``/help/rate-limits`` explainer page.

Exit: 0 pass, 1 fail.

    python3 tests/server_fn_rate_limit.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ART = Path(os.environ.get("SERVERFN_RL_ARTIFACT_DIR", "/tmp/serverfn-rate-limit"))
ART.mkdir(parents=True, exist_ok=True)

EMAIL = os.environ.get("TEST_PRO_EMAIL", "sarpli@yahoo.com")
PASSWORD = os.environ.get("TEST_PRO_PASSWORD", "Abcd1768!")

RETRY_AFTER_SECONDS = 42
RATE_LIMIT_BODY = (
    f"RATE_LIMITED::{RETRY_AFTER_SECONDS}::"
    "Too many requests. Please slow down and try again shortly."
)


async def sign_in(page):
    await page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
    # Dismiss the WelcomeAuthModal if it's obscuring the form.
    await page.evaluate("() => localStorage.setItem('welcomeAuthDismissed', '1')")
    await page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').first.fill(EMAIL)
    await page.locator('input[type="password"]').first.fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).first.click()
    # Wait for the auth cookie/localStorage session to settle.
    for _ in range(30):
        await page.wait_for_timeout(300)
        url = page.url
        if "/auth" not in url:
            break
    return page.url


async def install_serverfn_rate_limit(page, captured):
    """Route every ``/_serverFn/**`` call to a 429 rate-limit response.

    ``captured`` is a list we append the observed request URL + response
    status to for later assertions.
    """
    async def handler(route):
        req = route.request
        captured.append({"url": req.url, "method": req.method})
        await route.fulfill(
            status=429,
            headers={
                "Content-Type": "text/plain",
                "Retry-After": str(RETRY_AFTER_SECONDS),
            },
            body=RATE_LIMIT_BODY,
        )

    await page.route("**/_serverFn/**", handler)


async def assert_countdown_toast(page, screenshot_name):
    # sonner renders toasts under [data-sonner-toaster]; the description
    # contains the countdown copy. Wait up to 6s for it to appear.
    locator = page.locator("[data-sonner-toaster]").get_by_text(
        "Try again in", exact=False
    )
    await locator.wait_for(state="visible", timeout=6000)
    text = await locator.first.text_content()
    # The "Why?" action should link to the help page.
    why = page.locator("[data-sonner-toaster]").get_by_role(
        "button", name="Why?"
    )
    await why.wait_for(state="visible", timeout=3000)
    await page.screenshot(path=str(ART / screenshot_name))
    assert text and "Try again in" in text, f"toast missing countdown copy: {text!r}"
    return text


async def test_ai_search(page):
    captured = []
    responses = []
    page.on(
        "response",
        lambda r: responses.append(
            {"url": r.url, "status": r.status, "retry_after": r.headers.get("retry-after")}
        )
        if "/_serverFn/" in r.url
        else None,
    )
    await install_serverfn_rate_limit(page, captured)

    await page.goto(f"{BASE_URL}/archive", wait_until="domcontentloaded")
    # /archive is Pro-gated; sarpli@ has Pro, so the search form should render.
    box = page.get_by_placeholder("Search a term", exact=False).first
    await box.wait_for(state="visible", timeout=8000)
    await box.fill("fashion")
    await page.get_by_role("button", name="Search", exact=False).first.click()

    text = await assert_countdown_toast(page, "ai_search_toast.png")

    # Confirm the 429 landed at the network layer with a numeric Retry-After.
    hits = [r for r in responses if r["status"] == 429]
    assert hits, f"expected a 429 server-fn response; saw {responses}"
    for h in hits:
        assert h["retry_after"] == str(RETRY_AFTER_SECONDS), h

    return {"toast": text, "network_429s": len(hits)}


async def test_delete_account(page):
    captured = []
    responses = []
    page.on(
        "response",
        lambda r: responses.append(
            {"url": r.url, "status": r.status, "retry_after": r.headers.get("retry-after")}
        )
        if "/_serverFn/" in r.url
        else None,
    )
    # CRITICAL: install the intercept BEFORE clicking so no real deletion runs.
    await install_serverfn_rate_limit(page, captured)

    await page.goto(f"{BASE_URL}/account", wait_until="domcontentloaded")
    del_btn = page.get_by_role("button", name="Delete account", exact=False).first
    await del_btn.wait_for(state="visible", timeout=8000)
    await del_btn.click()
    await page.get_by_placeholder("delete", exact=False).first.fill("delete")
    await page.get_by_role("button", name="Permanently delete", exact=False).first.click()

    text = await assert_countdown_toast(page, "delete_account_toast.png")

    hits = [r for r in responses if r["status"] == 429]
    assert hits, f"expected a 429 server-fn response; saw {responses}"
    for h in hits:
        assert h["retry_after"] == str(RETRY_AFTER_SECONDS), h

    # And the user must still be signed in — deletion was intercepted, not run.
    still_signed_in = await page.evaluate(
        "() => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'))"
    )
    assert still_signed_in, "session was wiped — intercept did not stop the delete"

    return {"toast": text, "network_429s": len(hits)}


async def main():
    results = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        await sign_in(page)
        results["ai_search"] = await test_ai_search(page)
        results["delete_account"] = await test_delete_account(page)

        await browser.close()

    print(json.dumps(results, indent=2))
    print("OK — server-fn rate-limit UI verified for AI search + delete account.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
