#!/usr/bin/env python3
"""E2E: signed-in non-Pro user can vote in Week / Month, but is fully
blocked from Year / OAT.

Asserts, for a signed-in free-tier account on /vote:
  * Week and Month boards render up/down chevrons; an upvote on row 1 fires
    a 2xx /rest/v1/votes write and the row's net-vote display ticks up.
  * The top ticker bar's percentage for the voted trend changes after the
    write (i.e. live update propagates).
  * Year and OAT boards render the 🔒 Pro CTA, never expose chevrons, and
    no /rest/v1/votes mutation is observed while interacting with them.
    Their leaderboard row order/scores are byte-identical before vs after.

If the account turns out to be Pro (gated boards expose chevrons) or no
session is injected, the test exits with code 2 (skipped).

    python3 tests/free_voting.py

Env: BASE_URL, FREE_VOTING_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("FREE_VOTING_ARTIFACT_DIR", "/tmp/free-voting-artifacts"))

OPEN = ("week", "month")
GATED = ("year", "oat")
LABEL = {
    "week": "Trend of the Week",
    "month": "Trend of the Month",
    "year": "Trend of the Year",
    "oat": "Trend of All Time",
}


async def restore_session(page) -> bool:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return False
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    return True


async def snapshot_board(page, cat: str):
    """Return [(term, score_text)] for every row in a board, in render order."""
    section = page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")
    rows = section.locator("li")
    n = await rows.count()
    out = []
    for i in range(n):
        text = (await rows.nth(i).inner_text()).strip()
        out.append(re.sub(r"\s+", " ", text))
    return out


async def ticker_percent_for_first_row(page, cat: str) -> str | None:
    """Read the ticker pill text for the term that's in row 1 of the board."""
    section = page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")
    first_row_text = (await section.locator("li").first.inner_text()).strip()
    # Symbol is uppercase letters/digits at the start of the row, e.g. "RIZZ".
    m = re.search(r"\b([A-Z0-9]{2,8})\b", first_row_text)
    if not m:
        return None
    symbol = m.group(1)
    ticker_items = page.locator(f"text=/^{re.escape(symbol)}\\s/")
    if await ticker_items.count() == 0:
        return None
    return (await ticker_items.first.inner_text()).strip()


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "free-voting-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    before_png = ARTIFACT_DIR / "before.png"
    after_png = ARTIFACT_DIR / "after.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    vote_writes: list[dict] = []
    writes_by_phase: dict[str, list[dict]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        def on_response(resp):
            url = resp.url
            method = resp.request.method
            network_fh.write(f"{resp.status} {method} {url}\n")
            if "/rest/v1/votes" in url and method in ("POST", "PATCH", "DELETE"):
                vote_writes.append({"status": resp.status, "method": method, "url": url})

        page.on("response", on_response)

        if not await restore_session(page):
            print("SKIP: no injected Supabase session; sign in as a free-tier user to run.", file=sys.stderr)
            return 2

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
        except Exception as e:
            await page.screenshot(path=str(before_png))
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(before_png))

        async def section_of(cat: str):
            return page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")

        # Tier guard: must be NON-Pro. Gated boards must show the lock CTA.
        for cat in GATED:
            sec = await section_of(cat)
            cta = await sec.get_by_title(f"{LABEL[cat]} — Pro only").count()
            chevrons = await sec.get_by_role("button", name="Vote up").count()
            if cta == 0 or chevrons > 0:
                print(f"SKIP: signed-in account isn't free-tier ({cat} exposes chevrons).", file=sys.stderr)
                summary_path.write_text(json.dumps({"skipped": True, "reason": f"{cat} unlocked"}, indent=2))
                return 2

        # --- Capture baselines for all four boards + ticker.
        boards_before = {c: await snapshot_board(page, c) for c in OPEN + GATED}
        ticker_before = {c: await ticker_percent_for_first_row(page, c) for c in OPEN}

        # --- Phase 1: vote up on Week & Month row 1.
        writes_by_phase["before_open_votes"] = list(vote_writes)
        for cat in OPEN:
            sec = await section_of(cat)
            await sec.get_by_role("button", name="Vote up").first.click()
            await page.wait_for_timeout(400)
        # Let optimistic UI + server write + invalidation settle.
        await page.wait_for_timeout(2000)
        writes_after_open = vote_writes[len(writes_by_phase["before_open_votes"]):]
        writes_by_phase["after_open_votes"] = writes_after_open

        # --- Phase 2: attempt to interact with Year & OAT (click the lock CTA),
        # then come back so the ensuing assertions read fresh DOM.
        writes_before_gated = list(vote_writes)
        for cat in GATED:
            sec = await section_of(cat)
            cta = sec.get_by_title(f"{LABEL[cat]} — Pro only").first
            try:
                # Click and ignore navigation; we'll go back.
                await cta.click(no_wait_after=True)
                await page.wait_for_timeout(400)
                if "/pricing" in page.url:
                    await page.go_back()
                    await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=8000)
                    await page.wait_for_timeout(800)
            except Exception as e:
                console_fh.write(f"gated click {cat} threw: {e}\n")
        writes_from_gated = vote_writes[len(writes_before_gated):]
        writes_by_phase["from_gated_clicks"] = writes_from_gated

        # Final snapshot.
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(after_png))
        boards_after = {c: await snapshot_board(page, c) for c in OPEN + GATED}
        ticker_after = {c: await ticker_percent_for_first_row(page, c) for c in OPEN}

        errors: list[str] = []

        # 1) Week & Month should each have produced at least one 2xx vote write.
        for cat in OPEN:
            cat_writes = writes_after_open  # both votes share the bucket
        if not any(200 <= w["status"] < 300 for w in writes_after_open):
            errors.append(f"no 2xx /rest/v1/votes write fired for Week+Month upvotes (got {writes_after_open})")
        if len([w for w in writes_after_open if 200 <= w["status"] < 300]) < len(OPEN):
            errors.append(f"expected >= {len(OPEN)} successful vote writes from open boards, got {writes_after_open}")

        # 2) Week & Month boards' row 1 should have changed (score bumped or
        # row order shuffled). Compare full board snapshots.
        for cat in OPEN:
            if boards_before[cat] == boards_after[cat]:
                errors.append(f"{cat} leaderboard did not change after upvote (before == after)")

        # 3) Ticker pill for the voted trend should reflect a new percentage.
        for cat in OPEN:
            b = ticker_before[cat]
            a = ticker_after[cat]
            if b and a and b == a:
                errors.append(f"ticker pill for {cat} row-1 trend unchanged: {b!r}")

        # 4) Year & OAT must NOT have produced any vote writes during gated clicks.
        gated_mutations = [w for w in writes_from_gated]
        if gated_mutations:
            errors.append(f"unexpected /rest/v1/votes writes from gated boards: {gated_mutations}")

        # 5) Year & OAT leaderboards must be byte-identical before vs after
        # (their data is independent of Week/Month votes).
        for cat in GATED:
            if boards_before[cat] != boards_after[cat]:
                errors.append(f"{cat} leaderboard changed despite gating (mutations blocked, but rows shifted)")

        results = {
            "boards_before": boards_before,
            "boards_after": boards_after,
            "ticker_before": ticker_before,
            "ticker_after": ticker_after,
            "writes_after_open": writes_after_open,
            "writes_from_gated": writes_from_gated,
            "errors": errors,
        }
        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps({k: v for k, v in results.items() if k != "boards_before" and k != "boards_after"}, indent=2))
    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: Free user voted in Week+Month with live updates; Year+OAT stayed locked.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
