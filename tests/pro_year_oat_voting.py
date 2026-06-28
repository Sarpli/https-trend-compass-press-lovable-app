#!/usr/bin/env python3
"""E2E for Pro-only boards (Year + OAT): ensures a Pro user can see vote
chevrons on both gated boards and that votes write successfully to
/rest/v1/votes.

Unlike tests/pro_voting.py (which only runs if the injected session is
already on a Pro tier), this test will OPTIONALLY upgrade the signed-in
account to pro_annual via the subscription fixture when
PRO_FIXTURE_SERVICE_KEY is provided, run the assertions, then revert to
the original tier in a finally block.

Flow:
  1. Restore the injected Supabase session.
  2. Open /vote and look at the OAT board.
       - If the OAT lock CTA is present (free/non-Pro), apply the upgrade
         fixture to set the user to pro_annual, then reload.
       - If no fixture key is available and the account is non-Pro, skip
         with exit 2.
  3. For each of Year and OAT:
       - Assert zero Pro lock CTAs on that board.
       - Assert >=1 Vote up + Vote down chevrons rendered.
       - Click row-1 Vote up, wait for the optimistic active state.
       - Wait for a `POST /rest/v1/votes` 2xx (request + response captured).
       - Toggle off (idempotent cleanup) and require a second 2xx write.
  4. finally: revert the subscription to the tier the test started from.

Exit codes: 0 pass, 1 fail, 2 skip.

    python3 tests/pro_year_oat_voting.py

Env: BASE_URL, PRO_YEAR_OAT_ARTIFACT_DIR, PRO_FIXTURE_SERVICE_KEY.
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
ARTIFACT_DIR = Path(os.environ.get("PRO_YEAR_OAT_ARTIFACT_DIR", "/tmp/pro-year-oat-artifacts"))

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


def patch_subscription(url: str, key: str, user_id: str, tier: str) -> tuple[int, str]:
    body = json.dumps({"tier": tier, "status": "active"}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/subscriptions?user_id=eq.{user_id}",
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def get_subscription_tier(url: str, key: str, user_id: str) -> str | None:
    req = urllib.request.Request(
        f"{url}/rest/v1/subscriptions?user_id=eq.{user_id}&select=tier,status",
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


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "pro-year-oat-summary.json"
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
                vote_responses.append({"status": resp.status, "method": method, "url": url})

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

        # If the OAT lock CTA is present, the account is non-Pro; upgrade if possible.
        oat_sec = await board(page, "oat")
        oat_locked = await oat_sec.get_by_title(f"{LABEL['oat']} — Pro only").count() > 0
        if oat_locked:
            if not (sb_url and service_key):
                print(
                    "SKIP: account is non-Pro and PRO_FIXTURE_SERVICE_KEY not set; "
                    "cannot upgrade for the test.",
                    file=sys.stderr,
                )
                return 2
            revert_tier = get_subscription_tier(sb_url, service_key, user_id) or "free"
            up_status, up_body = patch_subscription(sb_url, service_key, user_id, "pro_annual")
            if not (200 <= up_status < 300):
                print(f"FAIL: upgrade PATCH failed {up_status}: {up_body[:200]}", file=sys.stderr)
                return 1
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_role("heading", name=LABEL["oat"]).wait_for(timeout=15000)
            await page.wait_for_timeout(1500)

        results: dict = {
            "user_id": user_id,
            "upgraded_for_test": oat_locked,
            "revert_tier": revert_tier,
            "per_board": {},
            "errors": [],
        }

        try:
            for cat in GATED:
                sec = await board(page, cat)
                locks = await sec.get_by_title(f"{LABEL[cat]} — Pro only").count()
                up_buttons = sec.get_by_role("button", name="Vote up")
                down_buttons = sec.get_by_role("button", name="Vote down")
                up_count = await up_buttons.count()
                down_count = await down_buttons.count()

                board_result: dict = {
                    "lock_ctas": locks,
                    "up_chevrons": up_count,
                    "down_chevrons": down_count,
                }
                results["per_board"][cat] = board_result

                if locks != 0:
                    results["errors"].append(f"{cat}: lock CTA still rendered for Pro user (count={locks})")
                if up_count == 0 or down_count == 0:
                    results["errors"].append(
                        f"{cat}: chevrons missing for Pro user (up={up_count}, down={down_count})"
                    )
                    continue

                # Click row-1 upvote, wait for 2xx + active state.
                first_up = up_buttons.first
                writes_before = len(vote_responses)
                await first_up.click()
                try:
                    await page.wait_for_function(
                        "(btn) => btn && btn.className && btn.className.includes('border-ticker-up')",
                        arg=await first_up.element_handle(),
                        timeout=5000,
                    )
                except Exception as e:
                    results["errors"].append(f"{cat}: upvote never reached active state: {e}")
                await page.wait_for_timeout(1000)
                writes_after_up = vote_responses[writes_before:]
                board_result["up_writes"] = writes_after_up
                if not any(200 <= w["status"] < 300 for w in writes_after_up):
                    results["errors"].append(
                        f"{cat}: no 2xx /rest/v1/votes after upvote (got {writes_after_up})"
                    )

                # Toggle off so the test is idempotent.
                await first_up.click()
                await page.wait_for_timeout(1000)
                writes_after_clear = vote_responses[writes_before:]
                clear_only = writes_after_clear[len(writes_after_up):]
                board_result["clear_writes"] = clear_only
                if not any(200 <= w["status"] < 300 for w in clear_only):
                    results["errors"].append(
                        f"{cat}: no 2xx /rest/v1/votes after toggle-off (got {clear_only})"
                    )

            await page.screenshot(path=str(vote_png))
        finally:
            # If we upgraded the user, always revert to whatever tier they
            # were on before so the test is non-destructive.
            if revert_tier and sb_url and service_key and user_id:
                rs, _ = patch_subscription(sb_url, service_key, user_id, revert_tier)
                results["final_revert_status"] = rs

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: Pro user can vote on both Year and OAT; writes recorded.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))