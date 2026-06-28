#!/usr/bin/env python3
"""E2E: free-tier user clicks the Year and OAT lock CTAs on /vote and
asserts zero /rest/v1/votes mutation requests are fired.

Flow:
  1. Restore the injected Supabase session.
  2. Skip (exit 2) if the session is already Pro (no lock CTAs to click).
  3. Open /vote, wait for both gated boards to render.
  4. For each of Year and OAT:
       * Assert the "<Board> — Pro only" lock CTA renders.
       * Assert zero Vote up / Vote down chevrons render inside the section.
       * Click the lock CTA (it navigates to /pricing) and immediately go
         back so the next board can be tested from the same /vote page.
  5. Assert zero POST/PATCH/DELETE requests to /rest/v1/votes occurred at
     any point during the run.

Exit codes: 0 pass · 1 fail · 2 skip.

Env: BASE_URL, FREE_GATED_CTA_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("FREE_GATED_CTA_ARTIFACT_DIR", "/tmp/free-gated-cta-artifacts"))
GATED = ("year", "oat")
LABEL = {"year": "Trend of the Year", "oat": "Trend of All Time"}


async def restore_session(page) -> bool:
    sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (sj and sk):
        return False
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
    )
    return True


async def board(page, cat: str):
    return page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "free-gated-cta-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    shot = ARTIFACT_DIR / "vote.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    vote_mutations: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        def on_request(req):
            method = req.method
            url = req.url
            network_fh.write(f"REQ {method} {url}\n")
            if "/rest/v1/votes" in url and method in ("POST", "PATCH", "DELETE"):
                vote_mutations.append({"method": method, "url": url})

        page.on("request", on_request)

        if not await restore_session(page):
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1000)

        # If no lock CTA on OAT, this account is Pro — no CTAs to test.
        oat_sec = await board(page, "oat")
        if await oat_sec.get_by_title(f"{LABEL['oat']} — Pro only").count() == 0:
            print("SKIP: session is Pro; no lock CTAs to click.", file=sys.stderr)
            return 2

        results: dict = {"per_board": {}, "errors": []}

        for cat in GATED:
            sec = await board(page, cat)
            cta = sec.get_by_title(f"{LABEL[cat]} — Pro only")
            cta_count = await cta.count()
            up_count = await sec.get_by_role("button", name="Vote up").count()
            down_count = await sec.get_by_role("button", name="Vote down").count()

            br = {
                "cta_count": cta_count,
                "up_chevrons": up_count,
                "down_chevrons": down_count,
            }
            results["per_board"][cat] = br

            if cta_count < 1:
                results["errors"].append(f"{cat}: no lock CTA rendered")
                continue
            if up_count != 0 or down_count != 0:
                results["errors"].append(
                    f"{cat}: chevrons leaked into locked board (up={up_count}, down={down_count})"
                )

            mutations_before = len(vote_mutations)
            await cta.first.click()
            # CTA links to /pricing — wait for navigation, then return.
            try:
                await page.wait_for_url("**/pricing", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(400)
            br["mutations_during_click"] = vote_mutations[mutations_before:]
            if br["mutations_during_click"]:
                results["errors"].append(
                    f"{cat}: vote mutation fired on CTA click: {br['mutations_during_click']}"
                )

            # Return to /vote for the next board.
            await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
            await page.wait_for_timeout(800)

        await page.screenshot(path=str(shot))

        results["total_vote_mutations"] = len(vote_mutations)
        results["vote_mutations"] = vote_mutations
        if vote_mutations:
            results["errors"].append(
                f"unexpected /rest/v1/votes mutations: {vote_mutations}"
            )

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: non-Pro CTA clicks on Year + OAT fired zero /rest/v1/votes mutations.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))