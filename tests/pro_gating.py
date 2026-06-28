#!/usr/bin/env python3
"""E2E gating check for Pro-only vote categories.

For a signed-out (non-Pro) user on /vote:
  * The "Year" and "OAT" boards must render the locked "Pro" CTA in place
    of up/down chevron buttons.
  * Clicking any locked CTA must navigate to /pricing.
  * No mutating request to the votes table may fire from those boards.
  * The "Week" and "Month" boards must still render functional vote chevrons
    (sanity, so we know gating didn't break the page).

    python3 tests/pro_gating.py

Env: BASE_URL, GATING_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("GATING_ARTIFACT_DIR", "/tmp/gating-artifacts"))

GATED = ("year", "oat")
OPEN = ("week", "month")
LABEL = {
    "week": "Trend of the Week",
    "month": "Trend of the Month",
    "year": "Trend of the Year",
    "oat": "Trend of All Time",
}


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "gating-summary.json"
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
            # Supabase REST mutations against the votes table.
            if "/rest/v1/votes" in url and method in ("POST", "PATCH", "DELETE"):
                vote_writes.append({"method": method, "url": url})
            # Server-fn calls (in case voting ever moves server-side).
            if "/_serverFn/" in url and method != "GET":
                if "vote" in url.lower():
                    vote_writes.append({"method": method, "url": url})

        page.on("request", on_request)

        # Intentionally no auth session — we want the signed-out / non-Pro path.
        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        # Let boards render their data.
        try:
            await page.get_by_role("heading", name=LABEL["week"]).wait_for(timeout=10000)
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=10000)
        except Exception as e:
            print(f"vote page never rendered all boards: {e}", file=sys.stderr)
            await page.screenshot(path=str(screenshot_path))
            return 2
        # Give the leaderboard query a moment to populate rows.
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(screenshot_path))

        results: dict = {"boards": {}, "vote_writes_before_click": [], "vote_writes_after_click": [], "errors": []}

        async def board_locator(cat: str):
            heading = page.get_by_role("heading", name=LABEL[cat])
            return heading.locator("xpath=ancestor::section[1]")

        # 1) Gated boards must show lock CTAs, no chevrons.
        for cat in GATED:
            section = await board_locator(cat)
            up = section.get_by_role("button", name="Vote up")
            down = section.get_by_role("button", name="Vote down")
            pro_cta = section.get_by_title(f"{LABEL[cat]} — Pro only")
            up_count = await up.count()
            down_count = await down.count()
            cta_count = await pro_cta.count()
            results["boards"][cat] = {
                "up_buttons": up_count,
                "down_buttons": down_count,
                "pro_cta_buttons": cta_count,
            }
            if up_count != 0 or down_count != 0:
                results["errors"].append(f"{cat}: leaked vote buttons (up={up_count}, down={down_count})")
            if cta_count < 1:
                results["errors"].append(f"{cat}: no Pro lock CTA rendered (rows likely empty too)")

        # 2) Open boards still show chevrons.
        for cat in OPEN:
            section = await board_locator(cat)
            up_count = await section.get_by_role("button", name="Vote up").count()
            down_count = await section.get_by_role("button", name="Vote down").count()
            results["boards"][cat] = {"up_buttons": up_count, "down_buttons": down_count}
            if up_count < 1 or down_count < 1:
                results["errors"].append(f"{cat}: missing vote chevrons (up={up_count}, down={down_count})")

        results["vote_writes_before_click"] = list(vote_writes)

        # 3) Clicking the lock CTA must navigate to /pricing and must NOT fire a vote write.
        oat_section = await board_locator("oat")
        first_cta = oat_section.get_by_title(f"{LABEL['oat']} — Pro only").first
        try:
            await first_cta.click(timeout=5000)
            try:
                await page.wait_for_url("**/pricing", timeout=5000)
            except Exception:
                results["errors"].append(f"OAT lock CTA click did not navigate to /pricing (now at {page.url})")
        except Exception as e:
            results["errors"].append(f"could not click OAT lock CTA: {e}")

        # Give any (forbidden) mutation a chance to fire.
        await page.wait_for_timeout(800)
        results["vote_writes_after_click"] = list(vote_writes)
        results["final_url"] = page.url

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))

    failures = list(results["errors"])
    if vote_writes:
        failures.append(f"votes table mutated {len(vote_writes)} time(s) for non-Pro user: {vote_writes}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1
    print("OK: Pro gating verified — no vote mutations from gated categories.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
