#!/usr/bin/env python3
"""Direct REST attack test: as a non-Pro user, attempt to insert Year and
OAT votes straight against PostgREST (`/rest/v1/votes`) and assert each
write is rejected by RLS with no row persisted.

This bypasses the UI entirely — even if a malicious client crafted the
request by hand, the server policy must refuse `category in ('year','oat')`
for free-tier users. RLS policy:

    WITH CHECK ((auth.uid() = user_id)
      AND (weight = ANY (ARRAY[1, 2]))
      AND ((category = ANY (ARRAY['week','month'])) OR is_pro_self()))

Flow:
  1. Restore the injected Supabase session and read its access token.
  2. Tier guard — read /rest/v1/subscriptions for the current user.
     If the row is `pro_monthly`/`pro_annual` + active, skip with exit 2.
  3. Snapshot the user's own votes (RLS-scoped self-read) for Year + OAT.
  4. For each gated category, POST a hand-crafted vote with weight 1
     against an existing trend_id. Assert HTTP status is 4xx (403/401)
     and the error body mentions RLS / row-level security / policy.
  5. Re-read the user's votes and assert the count for that category is
     unchanged — no row was written.

Exit codes: 0 pass, 1 fail, 2 skip.
    python3 tests/gated_rest_rejected.py
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
ARTIFACT_DIR = Path(os.environ.get("GATED_REST_ARTIFACT_DIR", "/tmp/gated-rest-artifacts"))
GATED = ("year", "oat")


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


def http(method: str, url: str, *, headers: dict, body: bytes | None = None):
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def current_period_key(cat: str) -> str:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    if cat == "week":
        iso = now.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if cat == "month":
        return now.strftime("%Y-%m")
    if cat == "year":
        return now.strftime("%Y")
    return "all"


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
    return {
        "access_token": sess["access_token"],
        "user_id": sess["user"]["id"],
    }


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    sb_url = env_lookup("SUPABASE_URL", "VITE_SUPABASE_URL")
    anon_key = env_lookup("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY")
    if not (sb_url and anon_key):
        print("SKIP: Supabase URL or publishable key not available.", file=sys.stderr)
        return 2
    sb_url = sb_url.rstrip("/")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await context.new_page()
        sess = await restore_session(page)
        await browser.close()

    if not sess:
        print("SKIP: no injected Supabase session.", file=sys.stderr)
        return 2

    auth_headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {sess['access_token']}",
        "Content-Type": "application/json",
    }

    # Tier guard — refuse to run as Pro (the policy WOULD allow the write).
    status, body = http(
        "GET",
        f"{sb_url}/rest/v1/subscriptions?user_id=eq.{sess['user_id']}&select=tier,status",
        headers=auth_headers,
    )
    if status >= 400:
        print(f"FAIL: subscription lookup {status}: {body[:200]}", file=sys.stderr)
        return 1
    rows = json.loads(body) if body else []
    tier = rows[0]["tier"] if rows else "free"
    sub_status = rows[0].get("status") if rows else "active"
    if tier in ("pro_monthly", "pro_annual") and sub_status == "active":
        print(f"SKIP: signed-in user is Pro ({tier}); rejection is not expected.", file=sys.stderr)
        return 2

    # Pick any trend to vote against.
    status, body = http(
        "GET",
        f"{sb_url}/rest/v1/trends?select=id&limit=1",
        headers=auth_headers,
    )
    if status >= 400 or not json.loads(body or "[]"):
        print(f"FAIL: cannot read a trend id {status}: {body[:200]}", file=sys.stderr)
        return 1
    trend_id = json.loads(body)[0]["id"]

    results = {
        "user_id": sess["user_id"],
        "tier": tier,
        "trend_id": trend_id,
        "per_category": {},
        "errors": [],
    }

    for cat in GATED:
        # Snapshot existing rows for this user+category before attack.
        s_b, b_b = http(
            "GET",
            f"{sb_url}/rest/v1/votes?user_id=eq.{sess['user_id']}&category=eq.{cat}&select=id",
            headers=auth_headers,
        )
        if s_b >= 400:
            results["errors"].append(f"{cat}: pre-snapshot read failed {s_b}: {b_b[:200]}")
            continue
        rows_before = json.loads(b_b)
        before_count = len(rows_before)

        payload = json.dumps({
            "user_id": sess["user_id"],
            "trend_id": trend_id,
            "category": cat,
            "period_key": current_period_key(cat),
            "direction": "up",
            "weight": 1,
        }).encode()

        post_status, post_body = http(
            "POST",
            f"{sb_url}/rest/v1/votes",
            headers={**auth_headers, "Prefer": "return=representation"},
            body=payload,
        )

        # Snapshot again.
        s_a, b_a = http(
            "GET",
            f"{sb_url}/rest/v1/votes?user_id=eq.{sess['user_id']}&category=eq.{cat}&select=id",
            headers=auth_headers,
        )
        after_count = len(json.loads(b_a)) if s_a < 400 else None

        per = {
            "post_status": post_status,
            "post_body_snippet": post_body[:300],
            "before_count": before_count,
            "after_count": after_count,
        }
        results["per_category"][cat] = per

        if not (400 <= post_status < 500):
            results["errors"].append(
                f"{cat}: expected 4xx rejection, got {post_status}: {post_body[:200]}"
            )
        else:
            low = post_body.lower()
            if not any(s in low for s in ("row-level security", "row level security", "policy", "violates")):
                results["errors"].append(
                    f"{cat}: 4xx response did not mention RLS/policy: {post_body[:200]}"
                )
        if after_count is None:
            results["errors"].append(f"{cat}: post-snapshot read failed")
        elif after_count != before_count:
            results["errors"].append(
                f"{cat}: row count changed (before={before_count}, after={after_count})"
            )

    (ARTIFACT_DIR / "gated-rest-summary.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: REST insert rejected for year + oat; no rows written.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))