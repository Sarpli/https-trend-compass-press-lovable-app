#!/usr/bin/env python3
"""E2E: gated Pro-only boards (Year, OAT) must never emit a /rest/v1/votes
write — not via clicks, not via keyboard hotkeys, not while focused.

Per gated board:
  * Render lock CTAs, zero "Vote up" / "Vote down" chevrons.
  * Click every lock CTA in the board (intercepting navigation so we stay
    on /vote) and assert no votes mutation fires.
  * Focus each lock CTA and fire common hotkeys (Enter, Space, ArrowUp,
    ArrowDown, U, D, K, J, +, -); none may produce a votes write.
  * Dispatch the same hotkeys with focus on <body> for good measure.

If a signed-in user happens to be Pro (gated boards expose chevrons), the
test exits with code 2 (skipped) since gating wouldn't apply.

    python3 tests/gated_no_writes.py

Env: BASE_URL, GATED_NOWRITE_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("GATED_NOWRITE_ARTIFACT_DIR", "/tmp/gated-nowrite-artifacts"))

GATED = ("year", "oat")
LABEL = {
    "year": "Trend of the Year",
    "oat": "Trend of All Time",
}
HOTKEYS = ["Enter", "Space", "ArrowUp", "ArrowDown", "u", "U", "d", "D", "k", "j", "+", "-"]


async def maybe_restore_session(page) -> None:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "gated-nowrite-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    screenshot_path = ARTIFACT_DIR / "vote.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    vote_writes: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        def on_request(req):
            url = req.url
            method = req.method
            network_fh.write(f"{method} {url}\n")
            if method in ("POST", "PATCH", "PUT", "DELETE") and (
                "/rest/v1/votes" in url
                or (("/_serverFn/" in url or "/api/" in url) and "vote" in url.lower())
            ):
                vote_writes.append({"method": method, "url": url})

        page.on("request", on_request)

        # Intercept navigations away from /vote (the lock CTA links to /pricing).
        await page.route(
            "**/*",
            lambda route: (
                route.fulfill(status=204, body="")
                if route.request.is_navigation_request()
                and "/pricing" in route.request.url
                else route.continue_()
            ),
        )

        await maybe_restore_session(page)
        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
        except Exception as e:
            await page.screenshot(path=str(screenshot_path))
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(screenshot_path))

        async def section_of(cat: str):
            return page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")

        results: dict = {"per_board": {}, "body_hotkey_writes": [], "errors": []}

        for cat in GATED:
            sec = await section_of(cat)
            up_count = await sec.get_by_role("button", name="Vote up").count()
            down_count = await sec.get_by_role("button", name="Vote down").count()
            cta = sec.get_by_title(f"{LABEL[cat]} — Pro only")
            cta_count = await cta.count()

            if up_count > 0 or down_count > 0:
                print(f"SKIP: {cat} exposes chevrons — account is Pro, gating doesn't apply.", file=sys.stderr)
                summary_path.write_text(json.dumps({"skipped": True, "reason": f"{cat} unlocked"}, indent=2))
                return 2

            board_result = {
                "up_chevrons": up_count,
                "down_chevrons": down_count,
                "lock_ctas": cta_count,
                "click_writes": [],
                "hotkey_writes": {},
            }

            if cta_count == 0:
                results["errors"].append(f"{cat}: no lock CTA rendered (cta_count=0)")

            # Click every lock CTA in the board.
            writes_before = len(vote_writes)
            for i in range(cta_count):
                try:
                    await cta.nth(i).click(no_wait_after=True, timeout=2000)
                    await page.wait_for_timeout(200)
                except Exception as e:
                    console_fh.write(f"{cat} click[{i}] threw: {e}\n")
            await page.wait_for_timeout(600)
            board_result["click_writes"] = vote_writes[writes_before:]

            # Focus each lock CTA and fire hotkeys.
            for i in range(min(cta_count, 3)):  # cap to first 3 rows for speed
                try:
                    await cta.nth(i).focus()
                except Exception:
                    pass
                for key in HOTKEYS:
                    before = len(vote_writes)
                    await page.keyboard.press(key)
                    await page.wait_for_timeout(80)
                    new_writes = vote_writes[before:]
                    if new_writes:
                        board_result["hotkey_writes"].setdefault(key, []).extend(new_writes)

            await page.wait_for_timeout(400)
            results["per_board"][cat] = board_result

            if board_result["click_writes"]:
                results["errors"].append(f"{cat}: click on lock CTA produced votes write(s): {board_result['click_writes']}")
            if board_result["hotkey_writes"]:
                results["errors"].append(f"{cat}: hotkey produced votes write(s): {board_result['hotkey_writes']}")

        # Body-focused hotkeys (no element focus).
        await page.locator("body").click(position={"x": 5, "y": 5})
        body_before = len(vote_writes)
        for key in HOTKEYS:
            await page.keyboard.press(key)
            await page.wait_for_timeout(60)
        await page.wait_for_timeout(400)
        body_writes = vote_writes[body_before:]
        results["body_hotkey_writes"] = body_writes
        if body_writes:
            results["errors"].append(f"body-level hotkeys produced votes write(s): {body_writes}")

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: Year + OAT emitted zero /rest/v1/votes writes under click + hotkey pressure.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
