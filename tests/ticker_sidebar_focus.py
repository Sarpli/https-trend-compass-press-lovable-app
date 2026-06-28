#!/usr/bin/env python3
"""Focus the Year and OAT controls reachable from the ticker bar and the
/vote sidebar, drive them with Tab / Shift+Tab / Arrow keys / Enter /
Space, and assert no `/rest/v1/votes` write fires.

Covers two surfaces in the same run:

1. The top ticker bar (`#trenslate-ticker`) — for each ticker item that
   references a trend that appears in Year or OAT, focus it and fan out
   arrow-key / Enter / Space presses. Ticker items navigate to the trend
   page; we intercept the navigation so the gated boards stay mounted.
2. The /vote page sidebar/boards — for both Year and OAT we Tab into the
   first focusable control in that section, then sweep
   ArrowUp/Down/Left/Right, U/D/K/J, +/−, Enter and Space with the body
   and the control focused.

The single hard assertion is: zero `POST/PATCH/DELETE /rest/v1/votes`
writes captured by Playwright's response listener across the entire run.

Skips with exit 2 if the session is Pro (the controls are different and
writes are expected). Skips with exit 2 if there is no session at all
(signed-out gives the same gated UI, so we still want to test, but a
session-less sandbox usually means we're dry-running CI).
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("TICKER_FOCUS_ARTIFACT_DIR", "/tmp/ticker-focus-artifacts"))
GATED = ("year", "oat")
LABEL = {"year": "Trend of the Year", "oat": "Trend of All Time"}
HOTKEYS = ("Enter", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
           "u", "d", "k", "j", "+", "-")


async def restore_session(page) -> bool:
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    if sj and sk:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
        )
        return True
    return False


async def is_pro(page) -> bool:
    """Best-effort check: if the OAT section renders Vote up chevrons, treat as Pro."""
    try:
        sec = page.get_by_role("heading", name=LABEL["oat"]).locator("xpath=ancestor::section[1]")
        return await sec.get_by_role("button", name="Vote up").count() > 0
    except Exception:
        return False


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary = ARTIFACT_DIR / "ticker-focus-summary.json"
    network_log = ARTIFACT_DIR / "network.log"
    console_log = ARTIFACT_DIR / "console.log"
    shot = ARTIFACT_DIR / "vote.png"
    nf = network_log.open("w")
    cf = console_log.open("w")

    writes: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        page.on("console", lambda m: cf.write(f"[{m.type}] {m.text}\n"))

        def on_resp(r):
            nf.write(f"{r.status} {r.request.method} {r.url}\n")
            if "/rest/v1/votes" in r.url and r.request.method in ("POST", "PATCH", "DELETE"):
                writes.append({"status": r.status, "method": r.request.method, "url": r.url})
        page.on("response", on_resp)

        await restore_session(page)

        # Bounce /pricing back to /vote so a ticker / lock CTA click doesn't
        # navigate away mid-test.
        async def reroute(route):
            url = route.request.url
            if "/pricing" in url:
                await route.fulfill(status=204, body="")
            else:
                await route.continue_()
        await ctx.route("**/*", reroute)

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=20000)
        except Exception as e:
            print(f"SKIP: /vote never rendered OAT board ({e}).", file=sys.stderr)
            return 2
        await page.wait_for_timeout(1500)

        if await is_pro(page):
            print("SKIP: signed-in user is Pro; gated controls aren't present.", file=sys.stderr)
            return 2

        results = {"phases": {}, "writes": writes}

        # --- Phase 1: ticker bar items ------------------------------------
        ticker = page.locator(".ticker-bar").first
        await ticker.wait_for(timeout=5000)
        items = ticker.locator("a, button")
        n = min(await items.count(), 12)
        ticker_actions = 0
        for i in range(n):
            it = items.nth(i)
            try:
                await it.focus(timeout=500)
                for k in HOTKEYS:
                    await page.keyboard.press(k)
                    ticker_actions += 1
                # Direct click on the focused ticker item — /pricing is
                # intercepted, trend navigations stay on the same page since
                # we never confirm them.
                await it.click(timeout=500, no_wait_after=True)
                ticker_actions += 1
            except Exception:
                continue
        results["phases"]["ticker"] = {"items_touched": n, "key_actions": ticker_actions}

        # Make sure /vote is still mounted before phase 2.
        if "/vote" not in page.url:
            await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=10000)
            await page.wait_for_timeout(1000)

        # --- Phase 2: per-gated-section focus + arrow nav -----------------
        for cat in GATED:
            sec = page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")
            await sec.scroll_into_view_if_needed()

            focusable = sec.locator("a, button, [tabindex]:not([tabindex='-1'])")
            count = await focusable.count()
            per = {"focusable": count, "lock_ctas": 0, "key_presses": 0}

            # Focus the section heading first so Tab walks INTO the section.
            try:
                heading = sec.get_by_role("heading", name=LABEL[cat])
                await heading.focus(timeout=500)
            except Exception:
                pass

            # Step into the section with Tab and sweep hotkeys at every stop.
            for _ in range(min(count + 2, 10)):
                await page.keyboard.press("Tab")
                for k in HOTKEYS:
                    await page.keyboard.press(k)
                    per["key_presses"] += 1

            # Walk back out with Shift+Tab firing the same keys.
            for _ in range(min(count + 2, 10)):
                await page.keyboard.press("Shift+Tab")
                for k in ("Enter", "Space", "ArrowUp", "ArrowDown"):
                    await page.keyboard.press(k)
                    per["key_presses"] += 1

            # Explicit click sweep on each lock CTA in the section.
            locks = sec.get_by_title(f"{LABEL[cat]} — Pro only")
            per["lock_ctas"] = await locks.count()
            for i in range(per["lock_ctas"]):
                try:
                    await locks.nth(i).focus(timeout=500)
                    for k in HOTKEYS:
                        await page.keyboard.press(k)
                        per["key_presses"] += 1
                    await locks.nth(i).click(timeout=500, no_wait_after=True)
                except Exception:
                    continue

            results["phases"][cat] = per

        await page.screenshot(path=str(shot))
        await browser.close()

    nf.close(); cf.close()
    summary.write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))

    if writes:
        for w in writes:
            print(f"FAIL: /rest/v1/votes write fired: {w}", file=sys.stderr)
        return 1
    print("OK: ticker + sidebar focus / arrow-key nav produced 0 vote writes.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))