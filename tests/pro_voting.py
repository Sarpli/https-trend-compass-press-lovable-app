#!/usr/bin/env python3
"""E2E vote check for a signed-in Pro user.

Requires the Lovable-injected Supabase session env vars
(LOVABLE_BROWSER_SUPABASE_SESSION_JSON / _STORAGE_KEY). The signed-in
account MUST be on a Pro tier (pro_monthly or pro_annual). The test:

  * Restores the injected session and opens /vote.
  * Confirms Week, Month, Year, and OAT boards all render up/down chevrons
    (no 🔒 Pro lock CTA on the gated boards).
  * Casts an upvote on the first row of each board (week, month, year, oat),
    waits for a 2xx response from /rest/v1/votes, asserts the button enters
    the active state, then clicks again to toggle the vote off and verifies
    a second 2xx clean-up write.

If the session env is missing or the account is not Pro, the test exits
with code 2 (skipped — explicit signal, not silent pass).

    python3 tests/pro_voting.py

Env: BASE_URL, PRO_VOTING_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("PRO_VOTING_ARTIFACT_DIR", "/tmp/pro-voting-artifacts"))

CATS = ("week", "month", "year", "oat")
GATED = ("year", "oat")
LABEL = {
    "week": "Trend of the Week",
    "month": "Trend of the Month",
    "year": "Trend of the Year",
    "oat": "Trend of All Time",
}

# JS readers used to snapshot leaderboard + ticker state by term name. We key
# off the term text (not rank) so reordering counts as a successful update.
JS_READ_BOARD_ROW = """
(args) => {
  const { heading, term } = args;
  const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === heading);
  if (!h) return null;
  const section = h.closest('section');
  if (!section) return null;
  const lis = [...section.querySelectorAll('li')];
  for (let i = 0; i < lis.length; i++) {
    const link = lis[i].querySelector('a');
    if (link && link.textContent.trim() === term) {
      const spans = [...lis[i].querySelectorAll('span.tabular-nums')];
      const netSpan = spans[spans.length - 1];
      const raw = (netSpan?.textContent || '0').replace('+','').trim();
      const n = parseInt(raw, 10);
      return { rank: i + 1, net: Number.isFinite(n) ? n : 0 };
    }
  }
  return null;
}
"""

JS_READ_TICKER_PCT = """
(term) => {
  const links = [...document.querySelectorAll('.ticker-bar a')];
  for (const a of links) {
    const nameSpan = a.querySelector('span.small-caps');
    if (nameSpan && nameSpan.textContent.trim() === term) {
      const spans = [...a.querySelectorAll('span')];
      const pctSpan = spans[spans.length - 1];
      return (pctSpan?.textContent || '').trim();
    }
  }
  return null;
}
"""


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


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "pro-voting-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    screenshot_path = ARTIFACT_DIR / "vote.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    vote_responses: list[dict] = []

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
                vote_responses.append({"status": resp.status, "method": method, "url": url})

        page.on("response", on_response)

        has_session = await restore_session(page)
        if not has_session:
            print("SKIP: no LOVABLE_BROWSER_SUPABASE_SESSION_JSON; sign in as Pro to run.", file=sys.stderr)
            await browser.close()
            return 2

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
        except Exception as e:
            await page.screenshot(path=str(screenshot_path))
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1

        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(screenshot_path))

        async def board(cat: str):
            heading = page.get_by_role("heading", name=LABEL[cat])
            return heading.locator("xpath=ancestor::section[1]")

        results: dict = {"per_category": {}, "errors": []}

        # 1) Tier check: gated boards must NOT show the lock CTA.
        for cat in GATED:
            sec = await board(cat)
            cta = await sec.get_by_title(f"{LABEL[cat]} — Pro only").count()
            if cta > 0:
                print(f"SKIP: signed-in user is not Pro — {cat} still shows the Pro lock CTA.", file=sys.stderr)
                summary_path.write_text(json.dumps({"skipped": True, "reason": f"{cat} locked"}, indent=2))
                await browser.close()
                return 2

        # 2) For every category, cast then toggle-off a vote on row 1.
        for cat in CATS:
            sec = await board(cat)
            up_buttons = sec.get_by_role("button", name="Vote up")
            up_count = await up_buttons.count()
            if up_count < 1:
                results["errors"].append(f"{cat}: no Vote up buttons rendered")
                continue
            first_up = up_buttons.first
            row = first_up.locator("xpath=ancestor::li[1]")
            # Capture the row-1 term so we can re-find this trend on the
            # leaderboard and ticker after a potential reorder.
            term = (await row.locator("a").first.inner_text()).strip()
            before_board = await page.evaluate(
                JS_READ_BOARD_ROW, {"heading": LABEL[cat], "term": term}
            )
            before_ticker = await page.evaluate(JS_READ_TICKER_PCT, term)

            writes_before = len(vote_responses)
            await first_up.click()
            try:
                # Wait for the optimistic active state to land (border-ticker-up).
                await page.wait_for_function(
                    """(btn) => btn && btn.className && btn.className.includes('border-ticker-up')""",
                    arg=await first_up.element_handle(),
                    timeout=5000,
                )
            except Exception as e:
                results["errors"].append(f"{cat}: upvote never reached active state: {e}")
            await page.wait_for_timeout(900)  # let realtime + write settle
            writes_after_up = vote_responses[writes_before:]

            # After the 2xx, the leaderboard row for this term must reflect
            # net+1 (rank may move up — we key off term text, not rank).
            after_board = await page.evaluate(
                JS_READ_BOARD_ROW, {"heading": LABEL[cat], "term": term}
            )
            # And the ticker pill for this term must change (price/pct shift
            # because net_votes changed; combinedDailyPct re-derives from it).
            after_ticker = await page.evaluate(JS_READ_TICKER_PCT, term)

            # Toggle the same vote off so the test is idempotent.
            await first_up.click()
            await page.wait_for_timeout(900)
            writes_after_clear = vote_responses[writes_before:]
            cleared_board = await page.evaluate(
                JS_READ_BOARD_ROW, {"heading": LABEL[cat], "term": term}
            )

            cat_result = {
                "term": term,
                "rows_rendered": up_count,
                "up_writes": writes_after_up,
                "all_writes": writes_after_clear,
                "board": {"before": before_board, "after_up": after_board, "after_clear": cleared_board},
                "ticker": {"before": before_ticker, "after_up": after_ticker},
            }
            results["per_category"][cat] = cat_result

            ok_up = any(200 <= w["status"] < 300 for w in writes_after_up)
            ok_clear = any(200 <= w["status"] < 300 for w in writes_after_clear[len(writes_after_up):])
            if not ok_up:
                results["errors"].append(f"{cat}: no 2xx /rest/v1/votes response after upvote (got {writes_after_up})")
            if not ok_clear:
                results["errors"].append(f"{cat}: no 2xx /rest/v1/votes response after toggle-off (got {writes_after_clear[len(writes_after_up):]})")

            # --- Live-update assertions (the new coverage) ---
            if before_board is None or after_board is None:
                results["errors"].append(
                    f"{cat}: could not locate leaderboard row for term '{term}' (before={before_board}, after={after_board})"
                )
            else:
                expected_net = before_board["net"] + 1
                if after_board["net"] != expected_net:
                    results["errors"].append(
                        f"{cat}: leaderboard net did not update immediately for '{term}': "
                        f"before={before_board['net']} expected={expected_net} after={after_board['net']}"
                    )
                # After toggle-off the row should be back where it started.
                if cleared_board is not None and cleared_board["net"] != before_board["net"]:
                    results["errors"].append(
                        f"{cat}: leaderboard did not revert after toggle-off for '{term}': "
                        f"before={before_board['net']} after_clear={cleared_board['net']}"
                    )

            if before_ticker is None or after_ticker is None:
                results["errors"].append(
                    f"{cat}: ticker pill not found for term '{term}' (before={before_ticker}, after={after_ticker})"
                )
            elif before_ticker == after_ticker:
                results["errors"].append(
                    f"{cat}: ticker pct did not change for '{term}' after upvote (still '{after_ticker}')"
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
    print("OK: Pro user can vote across Week / Month / Year / OAT.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
