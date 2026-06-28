#!/usr/bin/env python3
"""E2E for Pro Annual subscribers: verifies the founding-voter badge and
the 2× OAT vote weight end-to-end.

Flow:
  1. Restore the injected Supabase session and open /account.
  2. Tier guard — page must render BOTH:
       * "★ Founding OAT voter" (the Badge stat)
       * "2× weighted"           (the Vote weight stat)
     If either is missing, the account is not pro_annual → exit 2 (skip).
  3. Open /vote, locate the row-1 OAT trend.
  4. Snapshot the row's net-vote count from the leaderboard.
  5. Upvote that row. Intercept the POST /rest/v1/votes request and assert
       * status is 2xx
       * request body has weight === 2 and category === "oat"
  6. Wait for the optimistic active state, then assert the OAT leaderboard
     net for that term increased by exactly 2 (the annual weight).
  7. Toggle the vote off for idempotency and assert a 2xx clean-up write.

Requires LOVABLE_BROWSER_SUPABASE_SESSION_JSON / _STORAGE_KEY, and the
signed-in account must be on the pro_annual tier. Exit codes: 0 pass,
1 fail, 2 skip.

    python3 tests/annual_oat_voting.py

Env: BASE_URL, ANNUAL_OAT_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("ANNUAL_OAT_ARTIFACT_DIR", "/tmp/annual-oat-artifacts"))

OAT_HEADING = "Trend of All Time"
BADGE_TEXT = "★ Founding OAT voter"
WEIGHT_TEXT = "2× weighted"

JS_READ_BOARD_ROW = """
(args) => {
  const { heading, term } = args;
  const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === heading);
  if (!h) return null;
  const section = h.closest('section');
  if (!section) return null;
  for (const li of section.querySelectorAll('li')) {
    const link = li.querySelector('a');
    if (link && link.textContent.trim() === term) {
      const spans = [...li.querySelectorAll('span.tabular-nums')];
      const netSpan = spans[spans.length - 1];
      const raw = (netSpan?.textContent || '0').replace('+','').trim();
      const n = parseInt(raw, 10);
      return { net: Number.isFinite(n) ? n : 0 };
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


async def oat_section(page):
    return page.get_by_role("heading", name=OAT_HEADING).locator("xpath=ancestor::section[1]")


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "annual-oat-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    account_png = ARTIFACT_DIR / "account.png"
    vote_png = ARTIFACT_DIR / "vote.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    # Captured by listeners below.
    vote_requests: list[dict] = []   # {method, url, weight, category, direction}
    vote_responses: list[dict] = []  # {method, url, status}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        def on_request(req):
            if "/rest/v1/votes" not in req.url:
                return
            if req.method not in ("POST", "PATCH", "DELETE"):
                return
            body = req.post_data or ""
            weight = None
            category = None
            direction = None
            if body:
                try:
                    payload = json.loads(body)
                    # Insert is a single object; ignore Supabase array form too.
                    if isinstance(payload, list) and payload:
                        payload = payload[0]
                    if isinstance(payload, dict):
                        weight = payload.get("weight")
                        category = payload.get("category")
                        direction = payload.get("direction")
                except Exception:
                    pass
            vote_requests.append({
                "method": req.method,
                "url": req.url,
                "weight": weight,
                "category": category,
                "direction": direction,
            })

        def on_response(resp):
            network_fh.write(f"{resp.status} {resp.request.method} {resp.url}\n")
            if "/rest/v1/votes" in resp.url and resp.request.method in ("POST", "PATCH", "DELETE"):
                vote_responses.append({
                    "method": resp.request.method,
                    "url": resp.url,
                    "status": resp.status,
                })

        page.on("request", on_request)
        page.on("response", on_response)

        if not await restore_session(page):
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        # 1) Account-page tier guard.
        await page.goto(f"{BASE_URL}/account", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name="Plan").wait_for(timeout=8000)
        except Exception:
            pass  # heading may not be a <h*>; check text presence directly below.
        await page.wait_for_timeout(1000)
        await page.screenshot(path=str(account_png))
        body_text = (await page.locator("body").inner_text()).strip()
        has_badge = BADGE_TEXT in body_text
        has_weight = WEIGHT_TEXT in body_text
        results: dict = {
            "account_badge_visible": has_badge,
            "account_weight_visible": has_weight,
            "errors": [],
        }
        if not (has_badge and has_weight):
            print(
                f"SKIP: account is not pro_annual "
                f"(badge={has_badge}, weight2x={has_weight}); annual-only test not exercisable.",
                file=sys.stderr,
            )
            summary_path.write_text(json.dumps(results, indent=2))
            return 2

        # 2) OAT board.
        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1500)

        sec = await oat_section(page)
        # If gating is ever wrong for annual users, fail loudly — they must
        # NOT see the Pro lock CTA.
        if await sec.get_by_title(f"{OAT_HEADING} — Pro only").count() > 0:
            print("FAIL: annual subscriber sees Pro lock CTA on OAT board.", file=sys.stderr)
            return 1

        up_buttons = sec.get_by_role("button", name="Vote up")
        if await up_buttons.count() < 1:
            print("FAIL: OAT board rendered no Vote up chevrons for annual user.", file=sys.stderr)
            return 1
        first_up = up_buttons.first
        row = first_up.locator("xpath=ancestor::li[1]")
        term = (await row.locator("a").first.inner_text()).strip()

        before_board = await page.evaluate(
            JS_READ_BOARD_ROW, {"heading": OAT_HEADING, "term": term}
        )
        results["term"] = term
        results["before_board"] = before_board

        # 3) Upvote — capture write + assert weight=2 on OAT.
        writes_before = len(vote_responses)
        reqs_before = len(vote_requests)
        await first_up.click()
        try:
            await page.wait_for_function(
                "(btn) => btn && btn.className && btn.className.includes('border-ticker-up')",
                arg=await first_up.element_handle(),
                timeout=5000,
            )
        except Exception as e:
            results["errors"].append(f"OAT upvote never reached active state: {e}")
        await page.wait_for_timeout(1100)
        await page.screenshot(path=str(vote_png))

        new_reqs = vote_requests[reqs_before:]
        new_writes = vote_responses[writes_before:]
        results["upvote_requests"] = new_reqs
        results["upvote_responses"] = new_writes

        ok_up = any(200 <= w["status"] < 300 for w in new_writes)
        if not ok_up:
            results["errors"].append(f"no 2xx /rest/v1/votes after OAT upvote (responses={new_writes})")

        # Find the OAT insert/update request and check its weight.
        oat_writes = [r for r in new_reqs if r.get("category") == "oat"]
        if not oat_writes:
            results["errors"].append(
                f"no /rest/v1/votes write with category='oat' captured (requests={new_reqs})"
            )
        else:
            w = oat_writes[0]
            if w.get("weight") != 2:
                results["errors"].append(
                    f"OAT vote weight != 2 for annual subscriber (got weight={w.get('weight')}, full={w})"
                )
            if w.get("direction") != "up":
                results["errors"].append(
                    f"OAT vote direction != 'up' (got direction={w.get('direction')})"
                )

        # 4) Leaderboard net must increase by exactly 2 (the annual weight).
        after_board = await page.evaluate(
            JS_READ_BOARD_ROW, {"heading": OAT_HEADING, "term": term}
        )
        results["after_board"] = after_board
        if before_board is None or after_board is None:
            results["errors"].append(
                f"could not locate OAT leaderboard row for '{term}' "
                f"(before={before_board}, after={after_board})"
            )
        else:
            expected = before_board["net"] + 2
            if after_board["net"] != expected:
                results["errors"].append(
                    f"OAT leaderboard net for '{term}' did not increase by 2: "
                    f"before={before_board['net']} expected={expected} after={after_board['net']}"
                )

        # 5) Toggle off for idempotency — expect at least one more 2xx write.
        clear_before = len(vote_responses)
        await first_up.click()
        await page.wait_for_timeout(1100)
        clear_writes = vote_responses[clear_before:]
        results["cleanup_responses"] = clear_writes
        ok_clear = any(200 <= w["status"] < 300 for w in clear_writes)
        if not ok_clear:
            results["errors"].append(f"no 2xx /rest/v1/votes after OAT toggle-off (got {clear_writes})")

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: annual subscriber shows founding badge, 2× weight applied, OAT vote submitted.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))