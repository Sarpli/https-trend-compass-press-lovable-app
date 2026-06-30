#!/usr/bin/env python3
"""Security regressions: verify RLS + DB triggers continue to block
privilege escalation and Pro-gating bypasses via direct PostgREST calls.

What it covers (all via /rest/v1/* as the signed-in non-Pro user):

  A. profiles privileged-column updates
     - Attempt to PATCH is_founding_voter, push_enabled, streak_count,
       max_streak, last_active_date, last_active_local_date.
     - Trigger `profiles_block_privileged_updates` must silently revert
       these columns (or RLS must reject). Final row must match the
       pre-attack snapshot for every privileged field.

  B. votes immutable fields
     - Cast a legitimate `week` vote.
     - PATCH that row trying to change category → 'oat', weight 1 → 2,
       trend_id, or period_key. The `votes_block_field_mutation` trigger
       must raise; the stored row must be unchanged.
     - PATCH direction (the only mutable column) must succeed — sanity check.

  C. Pro-gating on insert
     - POST a category='oat' vote. Server must reject with 4xx mentioning
       RLS / policy / PRO_REQUIRED, and no row may be written.

  D. Vote weight constraint
     - POST a category='week' vote with weight=99. Must be rejected
       (invalid weight) and no row written.

Exit codes: 0 pass, 1 fail, 2 skip (no session / user is Pro).

    python3 tests/security_regressions.py
"""
import asyncio
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("SEC_REGRESSION_ARTIFACT_DIR", "/tmp/sec-regression-artifacts"))

PRIVILEGED_FIELDS = {
    "is_founding_voter": True,
    "push_enabled": True,
    "streak_count": 999999,
    "max_streak": 999999,
    "last_active_date": "1999-01-01",
    "last_active_local_date": "1999-01-01",
}


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


def week_key(now: datetime) -> str:
    iso = now.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


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


def section(name: str):
    print(f"\n=== {name} ===")


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    sb_url = env_lookup("SUPABASE_URL", "VITE_SUPABASE_URL")
    anon_key = env_lookup(
        "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"
    )
    if not (sb_url and anon_key):
        print("SKIP: Supabase URL or publishable key not available.", file=sys.stderr)
        return 2
    sb_url = sb_url.rstrip("/")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()
        sess = await restore_session(page)
        await browser.close()

    if not sess:
        print("SKIP: no injected Supabase session.", file=sys.stderr)
        return 2

    H = {
        "apikey": anon_key,
        "Authorization": f"Bearer {sess['access_token']}",
        "Content-Type": "application/json",
    }
    HR = {**H, "Prefer": "return=representation"}
    uid = sess["user_id"]

    # Tier guard — Pro users are allowed to insert OAT votes; skip section C/D
    # gating expectations for them but still run A/B (those apply to everyone).
    status, body = http(
        "GET", f"{sb_url}/rest/v1/subscriptions?user_id=eq.{uid}&select=tier,status", headers=H,
    )
    if status >= 400:
        print(f"FAIL: subscription lookup {status}: {body[:200]}", file=sys.stderr)
        return 1
    sub_rows = json.loads(body) if body else []
    tier = sub_rows[0]["tier"] if sub_rows else "free"
    sub_status = sub_rows[0].get("status") if sub_rows else "active"
    is_pro = tier in ("pro_monthly", "pro_annual") and sub_status == "active"

    # Admin check — admins legitimately bypass the privileged-column trigger,
    # so section A would always "fail" for them. Detect and skip.
    rs, rb = http(
        "GET", f"{sb_url}/rest/v1/user_roles?user_id=eq.{uid}&select=role", headers=H,
    )
    roles = [r.get("role") for r in (json.loads(rb or "[]") if rs < 400 else [])]
    is_admin = "admin" in roles

    results = {
        "user_id": uid, "tier": tier, "is_pro": is_pro, "is_admin": is_admin,
        "sections": {}, "errors": [],
    }

    # ---------- A. profiles privileged-column updates ----------
    section("A. profiles privileged columns")
    if is_admin:
        results["sections"]["profiles_privileged"] = {"skipped": "user is admin"}
        print("SKIP: user is admin — trigger legitimately allows privileged updates.")
    else:
    fields_csv = ",".join(PRIVILEGED_FIELDS.keys())
    s, b = http(
        "GET",
        f"{sb_url}/rest/v1/profiles?id=eq.{uid}&select={fields_csv}",
        headers=H,
    )
    if s >= 400 or not json.loads(b or "[]"):
        results["errors"].append(f"A: cannot read own profile {s}: {b[:200]}")
        before = {}
    else:
        before = json.loads(b)[0]

    patch_body = json.dumps(PRIVILEGED_FIELDS).encode()
    ps, pb = http(
        "PATCH",
        f"{sb_url}/rest/v1/profiles?id=eq.{uid}",
        headers=HR,
        body=patch_body,
    )

    s2, b2 = http(
        "GET",
        f"{sb_url}/rest/v1/profiles?id=eq.{uid}&select={fields_csv}",
        headers=H,
    )
    after = json.loads(b2)[0] if s2 < 400 and json.loads(b2 or "[]") else {}

    diffs = {}
    for k, v in before.items():
        if after.get(k) != v:
            diffs[k] = {"before": v, "attempted": PRIVILEGED_FIELDS[k], "after": after.get(k)}
    results["sections"]["profiles_privileged"] = {
        "patch_status": ps,
        "patch_body_snippet": pb[:200],
        "before": before,
        "after": after,
        "diffs": diffs,
    }
    if diffs:
        results["errors"].append(
            f"A: privileged profile columns changed via client PATCH: {list(diffs.keys())}"
        )
    else:
        print("OK: privileged profile columns unchanged after PATCH attack.")

    # ---------- B. votes immutable fields ----------
    section("B. votes immutable fields")
    # Need two trends so we can attempt to move the vote to a different trend_id.
    ts, tb = http("GET", f"{sb_url}/rest/v1/trends?select=id&limit=2", headers=H)
    trend_rows = json.loads(tb or "[]") if ts < 400 else []
    if len(trend_rows) < 2:
        results["errors"].append("B: need at least 2 trends to test trend_id mutation")
        trend_a = trend_rows[0]["id"] if trend_rows else None
        trend_b = trend_a
    else:
        trend_a = trend_rows[0]["id"]
        trend_b = trend_rows[1]["id"]

    now = datetime.now(timezone.utc)
    wk = week_key(now)

    vote_section = {"trend_a": trend_a, "trend_b": trend_b, "attempts": {}}
    vote_id = None

    if trend_a:
        # Clean any prior week vote for this user/trend so insert succeeds deterministically.
        http(
            "DELETE",
            f"{sb_url}/rest/v1/votes?user_id=eq.{uid}&trend_id=eq.{trend_a}&category=eq.week&period_key=eq.{wk}",
            headers=H,
        )

        insert_payload = json.dumps({
            "user_id": uid, "trend_id": trend_a, "category": "week",
            "period_key": wk, "direction": "up", "weight": 1,
        }).encode()
        ins_s, ins_b = http("POST", f"{sb_url}/rest/v1/votes", headers=HR, body=insert_payload)
        vote_section["insert_status"] = ins_s
        vote_section["insert_body_snippet"] = ins_b[:200]
        if ins_s >= 400:
            results["errors"].append(f"B: baseline week-vote insert failed {ins_s}: {ins_b[:200]}")
        else:
            try:
                vote_id = json.loads(ins_b)[0]["id"]
            except Exception:
                results["errors"].append(f"B: cannot parse insert response: {ins_b[:200]}")

    def patch_vote(label, patch_obj, expect_reject=True):
        if not vote_id:
            return
        s, b = http(
            "PATCH",
            f"{sb_url}/rest/v1/votes?id=eq.{vote_id}",
            headers=HR,
            body=json.dumps(patch_obj).encode(),
        )
        # Re-read the row to confirm storage is unchanged for the touched cols.
        rs, rb = http(
            "GET",
            f"{sb_url}/rest/v1/votes?id=eq.{vote_id}&select=trend_id,category,period_key,weight,direction",
            headers=H,
        )
        row = json.loads(rb)[0] if rs < 400 and json.loads(rb or "[]") else {}
        vote_section["attempts"][label] = {
            "patch_status": s, "patch_body_snippet": b[:200],
            "row_after": row, "expected_reject": expect_reject,
        }
        if expect_reject:
            if 200 <= s < 300:
                results["errors"].append(f"B/{label}: PATCH unexpectedly succeeded ({s})")
            for k, v in patch_obj.items():
                if row.get(k) == v:
                    results["errors"].append(
                        f"B/{label}: immutable column `{k}` was changed to {v!r}"
                    )
        else:
            if not (200 <= s < 300):
                results["errors"].append(f"B/{label}: PATCH expected to succeed, got {s}: {b[:200]}")

    patch_vote("change_category_to_oat", {"category": "oat"})
    patch_vote("escalate_weight_to_2", {"weight": 2})
    patch_vote("change_period_key", {"period_key": "1999-W01"})
    if trend_b and trend_b != trend_a:
        patch_vote("change_trend_id", {"trend_id": trend_b})
    # Sanity: direction must still be mutable.
    patch_vote("flip_direction_down", {"direction": "down"}, expect_reject=False)

    results["sections"]["votes_immutable"] = vote_section

    # Cleanup baseline vote — leave the database tidy.
    if vote_id:
        http("DELETE", f"{sb_url}/rest/v1/votes?id=eq.{vote_id}", headers=H)

    # ---------- C. Pro-gating on insert ----------
    section("C. Pro-gating on OAT insert")
    if is_pro:
        results["sections"]["pro_gating"] = {"skipped": "user is Pro"}
        print("SKIP: user is Pro — OAT insert is permitted.")
    elif not trend_a:
        results["errors"].append("C: no trend id available")
    else:
        before_s, before_b = http(
            "GET",
            f"{sb_url}/rest/v1/votes?user_id=eq.{uid}&category=eq.oat&select=id",
            headers=H,
        )
        before_n = len(json.loads(before_b or "[]")) if before_s < 400 else None
        oat_payload = json.dumps({
            "user_id": uid, "trend_id": trend_a, "category": "oat",
            "period_key": "all", "direction": "up", "weight": 1,
        }).encode()
        os_s, os_b = http("POST", f"{sb_url}/rest/v1/votes", headers=HR, body=oat_payload)
        after_s, after_b = http(
            "GET",
            f"{sb_url}/rest/v1/votes?user_id=eq.{uid}&category=eq.oat&select=id",
            headers=H,
        )
        after_n = len(json.loads(after_b or "[]")) if after_s < 400 else None
        results["sections"]["pro_gating"] = {
            "insert_status": os_s, "body_snippet": os_b[:200],
            "before_count": before_n, "after_count": after_n,
        }
        if not (400 <= os_s < 500):
            results["errors"].append(f"C: expected 4xx, got {os_s}: {os_b[:200]}")
        else:
            low = os_b.lower()
            if not any(s in low for s in (
                "row-level security", "row level security", "policy",
                "violates", "pro_required", "42501",
            )):
                results["errors"].append(f"C: rejection missing RLS/PRO_REQUIRED hint: {os_b[:200]}")
        if before_n is not None and after_n is not None and after_n != before_n:
            results["errors"].append(f"C: oat row count changed ({before_n} → {after_n})")

    # ---------- D. Invalid vote weight ----------
    section("D. Invalid vote weight")
    if not trend_a:
        results["errors"].append("D: no trend id available")
    else:
        wk2 = week_key(now)
        # Use a distinct trend if possible so we don't collide with section B's row.
        target = trend_b if (trend_b and trend_b != trend_a) else trend_a
        http(
            "DELETE",
            f"{sb_url}/rest/v1/votes?user_id=eq.{uid}&trend_id=eq.{target}&category=eq.week&period_key=eq.{wk2}",
            headers=H,
        )
        bad_payload = json.dumps({
            "user_id": uid, "trend_id": target, "category": "week",
            "period_key": wk2, "direction": "up", "weight": 99,
        }).encode()
        ws, wb = http("POST", f"{sb_url}/rest/v1/votes", headers=HR, body=bad_payload)
        # Snapshot
        cs, cb = http(
            "GET",
            f"{sb_url}/rest/v1/votes?user_id=eq.{uid}&trend_id=eq.{target}&category=eq.week&period_key=eq.{wk2}&select=id,weight",
            headers=H,
        )
        rows = json.loads(cb or "[]") if cs < 400 else []
        results["sections"]["invalid_weight"] = {
            "insert_status": ws, "body_snippet": wb[:200], "rows_after": rows,
        }
        if not (400 <= ws < 500):
            results["errors"].append(f"D: expected 4xx for weight=99, got {ws}: {wb[:200]}")
        if any(r.get("weight") == 99 for r in rows):
            results["errors"].append("D: weight=99 row was persisted")
        # Cleanup any accidentally-written row.
        for r in rows:
            http("DELETE", f"{sb_url}/rest/v1/votes?id=eq.{r['id']}", headers=H)

    # ---------- Summary ----------
    (ARTIFACT_DIR / "security-regression-summary.json").write_text(
        json.dumps(results, indent=2, default=str)
    )
    print("\n" + json.dumps(results, indent=2, default=str))

    if results["errors"]:
        print("\nFAILURES:", file=sys.stderr)
        for e in results["errors"]:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("\nOK: all security regressions held.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
