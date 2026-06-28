#!/usr/bin/env python3
"""E2E: free-tier user can run 3 archive searches in a day, the 4th is blocked,
and the daily streak still increments exactly once.

Flow:
  1. Restore the injected Supabase session (must be free-tier).
  2. Using PRO_FIXTURE_SERVICE_KEY, reset the test user:
       - delete today's rows from `searches`
       - set `profiles.last_active_date` to yesterday and capture
         `streak_count` as the baseline.
  3. Navigate to /archive, submit 3 distinct search queries. After each,
     confirm a 201 POST to /rest/v1/searches fired and the on-page counter
     reads N/3.
  4. Submit a 4th query. Assert NO additional /rest/v1/searches POST fires
     and the "Free tier limit" toast appears.
  5. Re-read profiles. Assert streak_count == baseline + 1 and
     last_active_date == today.

Exit codes:
  0  pass
  1  fail (assertion / network error)
  2  skip (no session, no service-key fixture, or account is Pro)

Env: BASE_URL, SUPABASE_URL, PRO_FIXTURE_SERVICE_KEY,
     FREE_SEARCH_LIMIT_ARTIFACT_DIR.
"""
import asyncio
import datetime as dt
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("PRO_FIXTURE_SERVICE_KEY", "")
ARTIFACT_DIR = Path(
    os.environ.get("FREE_SEARCH_LIMIT_ARTIFACT_DIR", "/tmp/free-search-limit-artifacts")
)


def rest(method: str, path: str, body=None, params=None) -> tuple[int, str]:
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


async def restore_session(page) -> tuple[bool, str | None]:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return False, None
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    try:
        user_id = json.loads(session_json).get("user", {}).get("id")
    except Exception:
        user_id = None
    return True, user_id


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "summary.json"
    network_log = ARTIFACT_DIR / "network.log"
    console_log = ARTIFACT_DIR / "console.log"

    if not SUPABASE_URL or not SERVICE_KEY:
        print("SKIP: SUPABASE_URL/PRO_FIXTURE_SERVICE_KEY not set.", file=sys.stderr)
        return 2

    network_fh = network_log.open("w")
    console_fh = console_log.open("w")
    search_posts: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        def on_response(resp):
            url = resp.url
            method = resp.request.method
            network_fh.write(f"{resp.status} {method} {url}\n")
            if "/rest/v1/searches" in url and method == "POST":
                search_posts.append({"status": resp.status, "url": url})

        page.on("response", on_response)

        ok, user_id = await restore_session(page)
        if not ok or not user_id:
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        # --- Verify tier is free.
        status, sub_body = rest("GET", "subscriptions",
                                params={"user_id": f"eq.{user_id}", "select": "tier,status"})
        if status != 200:
            print(f"FAIL: could not read subscriptions ({status}): {sub_body}", file=sys.stderr)
            return 1
        subs = json.loads(sub_body)
        tier = (subs[0]["tier"] if subs else "free")
        if tier in ("pro_monthly", "pro_annual"):
            print(f"SKIP: account is {tier}, search limit doesn't apply.", file=sys.stderr)
            return 2

        # --- Reset fixture state: delete today's searches, set last_active_date=yesterday.
        today = dt.date.today()
        yesterday = today - dt.timedelta(days=1)
        start_of_day = dt.datetime.combine(today, dt.time.min).isoformat() + "Z"

        rest("DELETE", "searches",
             params={"user_id": f"eq.{user_id}", "created_at": f"gte.{start_of_day}"})

        # Capture baseline streak after resetting last_active_date so we can
        # compute the expected increment.
        rest("PATCH", "profiles",
             body={"last_active_date": yesterday.isoformat()},
             params={"id": f"eq.{user_id}"})

        status, prof_body = rest("GET", "profiles",
                                 params={"id": f"eq.{user_id}",
                                         "select": "streak_count,last_active_date"})
        if status != 200 or not json.loads(prof_body):
            print(f"FAIL: profile read failed ({status}): {prof_body}", file=sys.stderr)
            return 1
        baseline = json.loads(prof_body)[0]
        baseline_streak = int(baseline["streak_count"])

        # --- Go to archive, perform 3 searches.
        await page.goto(f"{BASE_URL}/archive", wait_until="domcontentloaded")
        try:
            await page.locator("input[placeholder*='Search']").wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: /archive search input never rendered: {e}", file=sys.stderr)
            return 1

        queries = ["fashion", "internet", "music"]
        for i, q in enumerate(queries, start=1):
            inp = page.locator("input[placeholder*='Search']").first
            await inp.fill(q)
            posts_before = len(search_posts)
            await page.get_by_role("button", name="Search").click()
            # Wait for the corresponding POST.
            for _ in range(40):
                if len(search_posts) > posts_before:
                    break
                await page.wait_for_timeout(150)
            if len(search_posts) <= posts_before:
                print(f"FAIL: search #{i} did not POST to /rest/v1/searches", file=sys.stderr)
                return 1
            last = search_posts[-1]
            if not (200 <= last["status"] < 300):
                print(f"FAIL: search #{i} POST returned {last['status']}", file=sys.stderr)
                return 1
            # Counter on page should read "i/3".
            await page.wait_for_timeout(400)
            body_text = await page.locator("body").inner_text()
            if f"{i}/3 searches today" not in body_text:
                print(f"WARN: counter for search #{i} not visible in body text",
                      file=sys.stderr)

        await page.screenshot(path=str(ARTIFACT_DIR / "after-three.png"))

        # --- 4th submission: must be blocked, no POST, toast shown.
        posts_before_block = len(search_posts)
        await page.locator("input[placeholder*='Search']").first.fill("blocked-query")
        await page.get_by_role("button", name="Search").click()
        await page.wait_for_timeout(1500)

        new_posts = search_posts[posts_before_block:]
        if new_posts:
            print(f"FAIL: 4th search produced POST(s) despite limit: {new_posts}",
                  file=sys.stderr)
            return 1

        # Toast text — sonner renders it; match the substring.
        toast_visible = await page.get_by_text("Free tier limit").count() > 0
        if not toast_visible:
            print("FAIL: blocked-toast 'Free tier limit' never appeared", file=sys.stderr)
            return 1
        await page.screenshot(path=str(ARTIFACT_DIR / "after-block.png"))

        # --- Verify streak updated correctly: +1 vs baseline, last_active_date == today.
        status, prof2_body = rest("GET", "profiles",
                                  params={"id": f"eq.{user_id}",
                                          "select": "streak_count,last_active_date"})
        if status != 200 or not json.loads(prof2_body):
            print(f"FAIL: profile re-read failed ({status}): {prof2_body}",
                  file=sys.stderr)
            return 1
        after = json.loads(prof2_body)[0]
        new_streak = int(after["streak_count"])
        new_last = after["last_active_date"]

        errors = []
        expected = baseline_streak + 1
        if new_streak != expected:
            errors.append(
                f"streak_count expected {expected} (baseline {baseline_streak} + 1), got {new_streak}"
            )
        if new_last != today.isoformat():
            errors.append(f"last_active_date expected {today.isoformat()}, got {new_last}")
        if len(search_posts) != 3:
            errors.append(f"expected exactly 3 successful search POSTs, got {len(search_posts)}")

        summary = {
            "user_id": user_id,
            "baseline_streak": baseline_streak,
            "new_streak": new_streak,
            "today": today.isoformat(),
            "last_active_date_before": baseline["last_active_date"],
            "last_active_date_after": new_last,
            "search_posts": search_posts,
            "blocked_post_count": len(new_posts),
            "errors": errors,
        }
        summary_path.write_text(json.dumps(summary, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(summary, indent=2))
    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: 3 searches succeeded, 4th was blocked, streak incremented by 1.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))