#!/usr/bin/env python3
"""Verify the Back button on a trend entry restores the exact scroll
position of the previous page.

Scenarios:
  1. From the front page (/) -> trend entry -> Back.
  2. From the archive (/archive) -> trend entry -> Back.
  3. From the vote floor (/vote) -> trend entry -> Back.

For each path, we scroll the originating page to a non-trivial Y,
click a trend link, click the in-page Back button, and assert that
scrollY is restored within TOLERANCE pixels.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
TOLERANCE = int(os.environ.get("SCROLL_TOLERANCE", "8"))
ARTIFACTS = Path(os.environ.get("BACK_ARTIFACT_DIR", "/tmp/back-artifacts"))

SCENARIOS = [
    {"name": "front_page", "path": "/", "scroll_to": 900},
    {"name": "archive",    "path": "/archive", "scroll_to": 600},
    {"name": "vote",       "path": "/vote", "scroll_to": 700},
]


async def dismiss_modal(page):
    # WelcomeAuthModal blocks pointer events when signed out.
    try:
        await page.evaluate(
            "document.querySelectorAll('[role=\"dialog\"] button[aria-label=\"Close\"], "
            "[role=\"dialog\"] [data-dismiss]').forEach(b => b.click())"
        )
        await page.evaluate(
            "document.querySelectorAll('.fixed.inset-0.bg-black\\\\/60, "
            "[data-state=\"open\"][role=\"dialog\"]').forEach(el => el.remove())"
        )
    except Exception:
        pass


async def first_trend_href(page) -> str | None:
    return await page.evaluate(
        "() => { const a = document.querySelector('a[href^=\"/trends/\"]');"
        " return a ? a.getAttribute('href') : null; }"
    )


async def run_scenario(context, scenario) -> dict:
    page = await context.new_page()
    result = {"name": scenario["name"], "ok": False, "detail": ""}
    try:
        await page.goto(f"{BASE_URL}{scenario['path']}", wait_until="networkidle")
        await dismiss_modal(page)
        await page.wait_for_selector('a[href^="/trends/"]', timeout=10_000)

        # Scroll the originating page and record position.
        await page.evaluate(f"window.scrollTo(0, {scenario['scroll_to']})")
        await page.wait_for_timeout(150)
        before = await page.evaluate("window.scrollY")
        if before < 50:
            result["detail"] = f"page not scrollable enough (scrollY={before})"
            await page.screenshot(path=str(ARTIFACTS / f"{scenario['name']}_before.png"))
            return result

        href = await first_trend_href(page)
        if not href:
            result["detail"] = "no trend link found"
            return result

        # Click via JS so we don't fight with sticky overlays/animations.
        await page.evaluate(
            "(href) => document.querySelector(`a[href=\"${href}\"]`).click()", href
        )
        await page.wait_for_url(f"**{href}", timeout=10_000)
        await page.wait_for_selector('button[aria-label="Go back to previous page"]', timeout=10_000)
        await page.screenshot(path=str(ARTIFACTS / f"{scenario['name']}_entry.png"))

        # Click the Back button.
        await page.click('button[aria-label="Go back to previous page"]')
        await page.wait_for_url(f"**{scenario['path']}*", timeout=10_000)
        # Let TanStack Router's scroll restoration fire.
        # Poll for scroll restoration after async content fills in
        target = before
        for _ in range(20):
            await page.wait_for_timeout(150)
            cur = await page.evaluate("window.scrollY")
            if abs(cur - target) <= TOLERANCE:
                break
        after = await page.evaluate("window.scrollY")

        delta = abs(after - before)
        result["before"] = before
        result["after"] = after
        result["delta"] = delta
        result["ok"] = delta <= TOLERANCE
        if not result["ok"]:
            result["detail"] = f"scrollY drift {delta}px (before={before}, after={after})"
        await page.screenshot(path=str(ARTIFACTS / f"{scenario['name']}_after.png"))
    except Exception as e:
        result["detail"] = f"exception: {e!r}"
    finally:
        await page.close()
    return result


async def main() -> int:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    session = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})

        if session and storage_key:
            seed = await context.new_page()
            await seed.goto(BASE_URL)
            await seed.evaluate(
                "([k, v]) => window.localStorage.setItem(k, v)",
                [storage_key, session],
            )
            await seed.close()

        results = []
        for scenario in SCENARIOS:
            r = await run_scenario(context, scenario)
            results.append(r)
            print(r)

        await browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} scenarios passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
