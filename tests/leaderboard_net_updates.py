#!/usr/bin/env python3
"""E2E: assert Year + OAT leaderboard net values update immediately after a
2xx vote write for the same term, and revert when the vote is toggled off.

Flow:
  1. Restore the injected Supabase session.
  2. Open /vote; if the OAT lock CTA is present (non-Pro) and
     PRO_FIXTURE_SERVICE_KEY is set, PATCH the user's subscription to
     pro_annual so the gated boards expose chevrons; revert in `finally`.
  3. For each of Year and OAT:
       a. Pick the first row of the board, capture term + starting net.
       b. Click Vote up; wait for a 2xx POST /rest/v1/votes.
       c. Poll until the row matching that term shows net == start + 1
          (the row may re-sort; identify by term text, not index).
       d. Click Vote up again to toggle off; wait for a 2xx write
          (POST/PATCH/DELETE) and poll until the row's net returns to start.
  4. finally: revert subscription tier if upgraded.

Exit codes: 0 pass, 1 fail, 2 skip.
"""
import asyncio
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("LEADERBOARD_NET_ARTIFACT_DIR", "/tmp/leaderboard-net-artifacts"))

GATED = ("year", "oat")
LABEL = {"year": "Trend of the Year", "oat": "Trend of All Time"}


def supabase_url() -> str | None:
    for k in ("SUPABASE_URL", "VITE_SUPABASE_URL"):
        v = os.environ.get(k)
        if v:
            return v.rstrip("/")
    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            for k in ("SUPABASE_URL", "VITE_SUPABASE_URL"):
                if line.startswith(f"{k}="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return None


def patch_subscription(url: str, key: str, user_id: str, tier: str) -> int:
    body = json.dumps({"tier": tier, "status": "active"}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/subscriptions?user_id=eq.{user_id}",
        data=body, method="PATCH",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=representation"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def get_tier(url: str, key: str, user_id: str) -> str | None:
    req = urllib.request.Request(
        f"{url}/rest/v1/subscriptions?user_id=eq.{user_id}&select=tier",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read().decode("utf-8", "replace"))
            return rows[0]["tier"] if rows else None
    except Exception:
        return None


async def restore_session(page) -> str | None:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return None
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    try:
        return json.loads(session_json)["user"]["id"]
    except Exception:
        return None


async def board(page, cat: str):
    return page.get_by_role("heading", name=LABEL[cat]).locator("xpath=ancestor::section[1]")


async def read_net_for_term(page, cat: str, term: str) -> int | None:
    """Read the displayed net for the row containing `term` on `cat` board."""
    sec = await board(page, cat)
    # Each row is an <li> with a Link containing the term text and a net <span>.
    li = sec.locator("li", has=page.get_by_role("link", name=term, exact=True)).first
    if await li.count() == 0:
        return None
    # The net span is the one with tabular-nums classes and text like "+3" or "-2" or "0".
    spans = li.locator("span.tabular-nums")
    n = await spans.count()
    for i in range(n):
        txt = (await spans.nth(i).inner_text()).strip()
        if txt and (txt.lstrip("+-").isdigit()):
            try:
                return int(txt)
            except ValueError:
                continue
    return None


async def wait_for_net(page, cat: str, term: str, expected: int, timeout_ms: int = 6000) -> int | None:
    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000.0
    last = None
    while asyncio.get_event_loop().time() < deadline:
        last = await read_net_for_term(page, cat, term)
        if last == expected:
            return last
        await page.wait_for_timeout(150)
    return last


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "leaderboard-net-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    vote_png = ARTIFACT_DIR / "vote.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    vote_responses: list[dict] = []
    sb_url = supabase_url()
    service_key = os.environ.get("PRO_FIXTURE_SERVICE_KEY")
    revert_tier: str | None = None
    user_id: str | None = None

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
                vote_responses.append({"status": resp.status, "method": method})

        page.on("response", on_response)

        user_id = await restore_session(page)
        if not user_id:
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1200)

        oat_sec = await board(page, "oat")
        oat_locked = await oat_sec.get_by_title(f"{LABEL['oat']} — Pro only").count() > 0
        if oat_locked:
            if not (sb_url and service_key):
                print("SKIP: account non-Pro and PRO_FIXTURE_SERVICE_KEY not set.", file=sys.stderr)
                return 2
            revert_tier = get_tier(sb_url, service_key, user_id) or "free"
            if not (200 <= patch_subscription(sb_url, service_key, user_id, "pro_annual") < 300):
                print("FAIL: upgrade PATCH failed.", file=sys.stderr)
                return 1
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
            await page.wait_for_timeout(1500)

        results: dict = {"user_id": user_id, "upgraded": oat_locked, "per_board": {}, "errors": []}

        try:
            for cat in GATED:
                sec = await board(page, cat)
                up_buttons = sec.get_by_role("button", name="Vote up")
                if await up_buttons.count() == 0:
                    results["errors"].append(f"{cat}: no upvote chevrons rendered")
                    continue

                # Identify the term in row 1 from its Link text.
                first_row = sec.locator("li").first
                term = (await first_row.get_by_role("link").first.inner_text()).strip()
                start_net = await read_net_for_term(page, cat, term)
                if start_net is None:
                    results["errors"].append(f"{cat}: could not read starting net for '{term}'")
                    continue

                br: dict = {"term": term, "start_net": start_net}

                # Upvote.
                writes_before = len(vote_responses)
                await sec.locator("li", has=page.get_by_role("link", name=term, exact=True)).first \
                    .get_by_role("button", name="Vote up").click()
                await page.wait_for_timeout(1200)
                up_writes = vote_responses[writes_before:]
                br["up_writes"] = up_writes
                if not any(200 <= w["status"] < 300 for w in up_writes):
                    results["errors"].append(f"{cat}: no 2xx vote write after upvote on '{term}'")
                    continue

                after_up = await wait_for_net(page, cat, term, start_net + 1)
                br["net_after_up"] = after_up
                if after_up != start_net + 1:
                    results["errors"].append(
                        f"{cat}: net for '{term}' did not increment (start={start_net}, got={after_up})"
                    )

                # Toggle off.
                writes_before2 = len(vote_responses)
                await sec.locator("li", has=page.get_by_role("link", name=term, exact=True)).first \
                    .get_by_role("button", name="Vote up").click()
                await page.wait_for_timeout(1200)
                clear_writes = vote_responses[writes_before2:]
                br["clear_writes"] = clear_writes
                if not any(200 <= w["status"] < 300 for w in clear_writes):
                    results["errors"].append(f"{cat}: no 2xx vote write after toggle-off on '{term}'")

                after_clear = await wait_for_net(page, cat, term, start_net)
                br["net_after_clear"] = after_clear
                if after_clear != start_net:
                    results["errors"].append(
                        f"{cat}: net for '{term}' did not revert (start={start_net}, got={after_clear})"
                    )

                results["per_board"][cat] = br

            await page.screenshot(path=str(vote_png))
        finally:
            if revert_tier and sb_url and service_key and user_id:
                results["final_revert_status"] = patch_subscription(sb_url, service_key, user_id, revert_tier)

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: Year + OAT leaderboard nets increment on vote and revert on toggle-off.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))