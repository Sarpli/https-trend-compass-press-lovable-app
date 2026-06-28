#!/usr/bin/env python3
"""E2E: Free users cannot create or save items in the personal glossary;
Pro users can. Free UI surfaces never hit `/rest/v1/saved_glossary`.

Flow:
  1. Restore the injected Supabase session; ensure subscription = `free`
     (PATCH to `free` via PRO_FIXTURE_SERVICE_KEY when needed).
  2. UI: open `/glossary` (sees the upgrade card) and the first trend page
     (sees a "Save (Pro)" button), then click "Save (Pro)". Assert ZERO
     `POST/PATCH/DELETE/GET /rest/v1/saved_glossary` requests are fired by
     the Free session across both routes.
  3. REST: as Free, snapshot `saved_glossary` row count, attempt a direct
     POST against `/rest/v1/saved_glossary`, assert HTTP 4xx with an
     RLS/policy-shaped error and that the row count is unchanged.
  4. PATCH subscription -> `pro_annual / active` (fixture service key).
  5. REST: as the same user (now Pro), POST the same row -> assert 2xx
     and row count increments by 1. DELETE the row to clean up.
  6. Revert subscription -> `free / active` in a finally block.

Exit codes: 0 pass · 1 fail · 2 skip (no session / no service key).
    python3 tests/free_glossary_gated.py
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
ARTIFACT_DIR = Path(os.environ.get("FREE_GLOSSARY_ARTIFACT_DIR", "/tmp/free-glossary-gated-artifacts"))


def env_lookup(*names: str) -> str | None:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    p = Path(".env")
    if p.exists():
        for line in p.read_text().splitlines():
            for n in names:
                if line.startswith(f"{n}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def http(method, url, *, headers, body=None):
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def patch_subscription(url, key, user_id, tier):
    body = json.dumps({"tier": tier, "status": "active"}).encode()
    return http(
        "PATCH",
        f"{url}/rest/v1/subscriptions?user_id=eq.{user_id}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        body=body,
    )


async def restore_session(page):
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return None
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    sess = json.loads(session_json)
    return {"access_token": sess["access_token"], "user_id": sess["user"]["id"]}


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    sb_url = env_lookup("SUPABASE_URL", "VITE_SUPABASE_URL")
    anon_key = env_lookup("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY")
    service_key = os.environ.get("PRO_FIXTURE_SERVICE_KEY")
    if not (sb_url and anon_key):
        print("SKIP: Supabase URL or publishable key not available.", file=sys.stderr)
        return 2
    if not service_key:
        print("SKIP: PRO_FIXTURE_SERVICE_KEY required.", file=sys.stderr)
        return 2
    sb_url = sb_url.rstrip("/")

    results: dict = {"errors": [], "saved_glossary_requests_as_free": []}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1600})
        page = await context.new_page()

        sess = await restore_session(page)
        if not sess:
            await browser.close()
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        user_id = sess["user_id"]
        auth_headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {sess['access_token']}",
            "Content-Type": "application/json",
        }

        # Ensure we start as Free.
        ps, pb = patch_subscription(sb_url, service_key, user_id, "free")
        if not (200 <= ps < 300):
            print(f"FAIL: could not set Free fixture: {ps} {pb[:200]}", file=sys.stderr)
            await browser.close()
            return 1

        # Pick first trend.
        ts, tb = http(
            "GET",
            f"{sb_url}/rest/v1/trends?select=id,slug,term&order=created_at.asc&limit=1",
            headers=auth_headers,
        )
        trends = json.loads(tb) if ts < 400 else []
        if not trends:
            results["errors"].append(f"no trends available ({ts}): {tb[:200]}")
            await browser.close()
            print(json.dumps(results, indent=2))
            return 1
        trend = trends[0]
        results["trend"] = trend

        try:
            # --- Track every saved_glossary REST hit while Free.
            def on_request(req):
                url = req.url
                if "/rest/v1/saved_glossary" in url and req.method in ("GET", "POST", "PATCH", "DELETE"):
                    results["saved_glossary_requests_as_free"].append({
                        "method": req.method, "url": url,
                    })
            page.on("request", on_request)

            # Visit /glossary as Free → expect upgrade card, no rest call.
            await page.goto(f"{BASE_URL}/glossary", wait_until="domcontentloaded")
            await page.wait_for_timeout(1200)
            try:
                await page.get_by_text("Saving a glossary is a Pro feature.", exact=False).wait_for(timeout=4000)
                results["upgrade_card_visible"] = True
            except Exception:
                results["upgrade_card_visible"] = False
                results["errors"].append("Pro upgrade card not visible on /glossary as Free")
            await page.screenshot(path=str(ARTIFACT_DIR / "free-glossary.png"))

            # Visit trend page; click "Save (Pro)" button — must not POST.
            await page.goto(f"{BASE_URL}/trends/{trend['slug']}", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)
            save_btn = page.get_by_role("button", name="Save (Pro)")
            results["save_pro_button_visible"] = await save_btn.count() > 0
            if not results["save_pro_button_visible"]:
                results["errors"].append("'Save (Pro)' button not rendered on trend page as Free")
            else:
                try:
                    await save_btn.first.click()
                except Exception as e:
                    results["errors"].append(f"could not click Save (Pro): {e}")
                await page.wait_for_timeout(1500)
            await page.screenshot(path=str(ARTIFACT_DIR / "free-trend.png"))

            page.remove_listener("request", on_request)

            if results["saved_glossary_requests_as_free"]:
                results["errors"].append(
                    f"Free session made {len(results['saved_glossary_requests_as_free'])} saved_glossary REST request(s)"
                )

            # --- REST POST as Free → expect 4xx, no row created.
            sg_before_status, sg_before_body = http(
                "GET",
                f"{sb_url}/rest/v1/saved_glossary?user_id=eq.{user_id}&select=trend_id",
                headers=auth_headers,
            )
            free_before = len(json.loads(sg_before_body)) if sg_before_status < 400 else None
            payload = json.dumps({"user_id": user_id, "trend_id": trend["id"]}).encode()
            free_post_status, free_post_body = http(
                "POST",
                f"{sb_url}/rest/v1/saved_glossary",
                headers={**auth_headers, "Prefer": "return=representation"},
                body=payload,
            )
            sg_after_status, sg_after_body = http(
                "GET",
                f"{sb_url}/rest/v1/saved_glossary?user_id=eq.{user_id}&select=trend_id",
                headers=auth_headers,
            )
            free_after = len(json.loads(sg_after_body)) if sg_after_status < 400 else None
            results["free_rest"] = {
                "before": free_before, "after": free_after,
                "post_status": free_post_status,
                "post_body_snippet": free_post_body[:300],
            }
            if not (400 <= free_post_status < 500):
                results["errors"].append(
                    f"Free REST POST expected 4xx, got {free_post_status}: {free_post_body[:200]}"
                )
            else:
                low = free_post_body.lower()
                if not any(s in low for s in ("row-level security", "row level security", "policy", "violates")):
                    results["errors"].append(
                        f"Free REST 4xx did not mention RLS/policy: {free_post_body[:200]}"
                    )
            if free_after is None or free_before is None:
                results["errors"].append("saved_glossary snapshot read failed (Free)")
            elif free_after != free_before:
                results["errors"].append(
                    f"saved_glossary row count changed as Free (before={free_before}, after={free_after})"
                )

            # --- Upgrade to Pro and verify same POST now succeeds.
            up_status, up_body = patch_subscription(sb_url, service_key, user_id, "pro_annual")
            results["upgrade_status"] = up_status
            if not (200 <= up_status < 300):
                results["errors"].append(f"Pro upgrade PATCH failed {up_status}: {up_body[:200]}")
            else:
                pro_before_status, pro_before_body = http(
                    "GET",
                    f"{sb_url}/rest/v1/saved_glossary?user_id=eq.{user_id}&select=trend_id",
                    headers=auth_headers,
                )
                pro_before = len(json.loads(pro_before_body)) if pro_before_status < 400 else None
                pro_post_status, pro_post_body = http(
                    "POST",
                    f"{sb_url}/rest/v1/saved_glossary",
                    headers={**auth_headers, "Prefer": "return=representation"},
                    body=payload,
                )
                pro_after_status, pro_after_body = http(
                    "GET",
                    f"{sb_url}/rest/v1/saved_glossary?user_id=eq.{user_id}&select=trend_id",
                    headers=auth_headers,
                )
                pro_after = len(json.loads(pro_after_body)) if pro_after_status < 400 else None
                results["pro_rest"] = {
                    "before": pro_before, "after": pro_after,
                    "post_status": pro_post_status,
                    "post_body_snippet": pro_post_body[:300],
                }
                if not (200 <= pro_post_status < 300):
                    results["errors"].append(
                        f"Pro REST POST expected 2xx, got {pro_post_status}: {pro_post_body[:200]}"
                    )
                if pro_before is not None and pro_after is not None and pro_after != pro_before + 1:
                    results["errors"].append(
                        f"Pro POST did not add 1 row (before={pro_before}, after={pro_after})"
                    )
                # Cleanup row written above.
                http(
                    "DELETE",
                    f"{sb_url}/rest/v1/saved_glossary?user_id=eq.{user_id}&trend_id=eq.{trend['id']}",
                    headers=auth_headers,
                )
        finally:
            patch_subscription(sb_url, service_key, user_id, "free")
            await browser.close()

    (ARTIFACT_DIR / "summary.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: Free blocked from glossary writes (UI + REST); Pro succeeds.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
