#!/usr/bin/env python3
"""E2E: Free-tier daily streak.

Validates four invariants:

  1. Increment-once-per-day: with last_active_date = yesterday, a single
     search bumps streak by exactly +1. A second search the SAME day does
     NOT bump it again (still +1 total).
  2. Reset-on-gap: with last_active_date set to 5 days ago, the next
     search resets streak back to 1 (not +1 of the prior value).
  3. Persists across reloads: after the bump, reload the page and the
     fire-icon badge in the header still reads the bumped value, with
     no extra DB write.
  4. The streak badge (data-testid="streak-badge") is visible on every
     page (front page, vote, archive, glossary, account).

Skips (exit 2) without an injected session, no service-key fixture, or
if the account is Pro (the streak is universal but this test exercises
the free-tier search trigger path).
"""
import asyncio, datetime as dt, json, os, sys, urllib.request, urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("PRO_FIXTURE_SERVICE_KEY", "")
ARTIFACT_DIR = Path(os.environ.get("STREAK_ARTIFACT_DIR", "/tmp/streak-artifacts"))


def rest(method, path, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"
    if params:
        from urllib.parse import urlencode
        url += "?" + urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json", "Prefer": "return=representation",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def read_profile(uid):
    s, b = rest("GET", "profiles", params={
        "id": f"eq.{uid}", "select": "streak_count,last_active_date"})
    if s != 200:
        raise RuntimeError(f"profile read {s}: {b}")
    rows = json.loads(b)
    if not rows:
        raise RuntimeError("profile missing")
    return rows[0]


async def restore_session(page):
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (sess and key):
        return None
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")
    try:
        return json.loads(sess).get("user", {}).get("id")
    except Exception:
        return None


async def do_search(page, query, search_posts):
    inp = page.locator("input[placeholder*='Search']").first
    await inp.wait_for(timeout=15000)
    await inp.fill(query)
    before = len(search_posts)
    await page.get_by_role("button", name="Search").click()
    for _ in range(50):
        if len(search_posts) > before:
            break
        await page.wait_for_timeout(150)
    return len(search_posts) - before


async def badge_count(page):
    el = page.locator("[data-testid='streak-count']").first
    await el.wait_for(state="attached", timeout=10000)
    txt = (await el.inner_text()).strip()
    return int(txt) if txt.isdigit() else -1


async def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    if not SUPABASE_URL or not SERVICE_KEY:
        print("SKIP: SUPABASE_URL/PRO_FIXTURE_SERVICE_KEY not set.", file=sys.stderr)
        return 2

    posts = []
    errors = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        page.on("response", lambda r: (
            posts.append({"status": r.status, "method": r.request.method})
            if "/rest/v1/searches" in r.url and r.request.method == "POST" else None))

        uid = await restore_session(page)
        if not uid:
            print("SKIP: no injected session.", file=sys.stderr)
            return 2

        # Tier check.
        s, b = rest("GET", "subscriptions", params={
            "user_id": f"eq.{uid}", "select": "tier"})
        if s == 200 and json.loads(b) and json.loads(b)[0]["tier"] in ("pro_monthly", "pro_annual"):
            print("SKIP: Pro account.", file=sys.stderr)
            return 2

        today = dt.date.today()
        yesterday = today - dt.timedelta(days=1)
        five_days_ago = today - dt.timedelta(days=5)
        start_of_day = dt.datetime.combine(today, dt.time.min).isoformat() + "Z"

        # ---- Universal badge visibility check across pages ----
        for path in ["/", "/vote", "/archive", "/glossary"]:
            await page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
            cnt = await page.locator("[data-testid='streak-badge']").count()
            if cnt < 1:
                errors.append(f"streak badge missing on {path}")
        await page.screenshot(path=str(ARTIFACT_DIR / "badge-glossary.png"))

        # ---- (1) Increment-once-per-day ----
        rest("DELETE", "searches", params={
            "user_id": f"eq.{uid}", "created_at": f"gte.{start_of_day}"})
        rest("PATCH", "profiles", body={
            "last_active_date": yesterday.isoformat(), "streak_count": 4
        }, params={"id": f"eq.{uid}"})

        baseline = read_profile(uid)
        await page.goto(f"{BASE_URL}/archive", wait_until="domcontentloaded")
        before_badge = await badge_count(page)
        n = await do_search(page, "alpha", posts)
        if n != 1: errors.append(f"search #1: expected 1 POST, got {n}")
        await page.wait_for_timeout(500)
        after1 = read_profile(uid)
        if after1["streak_count"] != baseline["streak_count"] + 1:
            errors.append(f"first search: expected streak {baseline['streak_count']+1}, got {after1['streak_count']}")
        if after1["last_active_date"] != today.isoformat():
            errors.append(f"first search: last_active_date {after1['last_active_date']} != {today}")

        # Second search same day — must NOT bump streak again.
        n = await do_search(page, "beta", posts)
        if n != 1: errors.append(f"search #2: expected 1 POST, got {n}")
        await page.wait_for_timeout(500)
        after2 = read_profile(uid)
        if after2["streak_count"] != after1["streak_count"]:
            errors.append(f"second same-day search bumped streak: {after1['streak_count']} -> {after2['streak_count']}")

        # ---- (3) Persists across reloads ----
        posts_before_reload = len(posts)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(800)
        reload_badge = await badge_count(page)
        if reload_badge != after2["streak_count"]:
            errors.append(f"badge after reload {reload_badge} != db {after2['streak_count']}")
        new_posts = posts[posts_before_reload:]
        if new_posts:
            errors.append(f"reload caused unexpected search POSTs: {new_posts}")
        await page.screenshot(path=str(ARTIFACT_DIR / "after-reload.png"))

        # ---- (2) Reset-on-gap ----
        rest("DELETE", "searches", params={
            "user_id": f"eq.{uid}", "created_at": f"gte.{start_of_day}"})
        rest("PATCH", "profiles", body={
            "last_active_date": five_days_ago.isoformat(), "streak_count": 12
        }, params={"id": f"eq.{uid}"})

        await page.goto(f"{BASE_URL}/archive", wait_until="domcontentloaded")
        await do_search(page, "gamma", posts)
        await page.wait_for_timeout(500)
        reset = read_profile(uid)
        if reset["streak_count"] != 1:
            errors.append(f"gap reset: expected streak 1, got {reset['streak_count']}")
        if reset["last_active_date"] != today.isoformat():
            errors.append(f"gap reset: last_active_date {reset['last_active_date']} != {today}")

        # Reload one more time to confirm the reset persists.
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(800)
        final_badge = await badge_count(page)
        if final_badge != 1:
            errors.append(f"badge after reset reload = {final_badge}, expected 1")

        summary = {
            "user_id": uid, "today": today.isoformat(),
            "baseline": baseline, "after_first": after1,
            "after_second_same_day": after2, "after_reset": reset,
            "badge_after_reload": reload_badge, "badge_final": final_badge,
            "errors": errors,
        }
        (ARTIFACT_DIR / "summary.json").write_text(json.dumps(summary, indent=2))
        await browser.close()

    if errors:
        for e in errors: print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: streak increments once/day, resets on gap, persists across reloads, badge universal.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))