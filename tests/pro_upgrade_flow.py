#!/usr/bin/env python3
"""E2E: signed-in free user clicks the OAT lock CTA, "completes checkout"
via a Pro subscription fixture, returns to /vote, and verifies:

  * The OAT board no longer renders the 🔒 Pro CTA.
  * The OAT board now renders Vote up / Vote down chevrons.
  * The OAT board is still on-screen (scroll-position preserved or visible)
    so the user lands back at the category they were trying to vote in.

The Pro fixture upgrades the signed-in user's subscriptions row to
`pro_annual / active` via Supabase REST using a service-role key, then
reverts it to `free / active` in a finally block.

Required env:
  * LOVABLE_BROWSER_SUPABASE_SESSION_JSON / _STORAGE_KEY (injected session)
  * PRO_FIXTURE_SERVICE_KEY  — service-role key for the project's Data API
  * Optional: SUPABASE_URL or VITE_SUPABASE_URL (auto-detected from .env)

Exit codes: 0 pass, 1 fail, 2 skip (missing session or service key, or
the account is already Pro so the upgrade flow is not exercisable).

    python3 tests/pro_upgrade_flow.py

Env: BASE_URL, PRO_UPGRADE_ARTIFACT_DIR.
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
ARTIFACT_DIR = Path(os.environ.get("PRO_UPGRADE_ARTIFACT_DIR", "/tmp/pro-upgrade-artifacts"))


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


OAT_HEADING = "Trend of All Time"


async def oat_section(page):
    return page.get_by_role("heading", name=OAT_HEADING).locator("xpath=ancestor::section[1]")


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "pro-upgrade-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    before_png = ARTIFACT_DIR / "before.png"
    pricing_png = ARTIFACT_DIR / "pricing.png"
    after_png = ARTIFACT_DIR / "after.png"
    console_fh = console_log.open("w")

    sb_url = supabase_url()
    service_key = os.environ.get("PRO_FIXTURE_SERVICE_KEY")
    if not (sb_url and service_key):
        print("SKIP: PRO_FIXTURE_SERVICE_KEY (and SUPABASE_URL) required for upgrade fixture.", file=sys.stderr)
        return 2

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        page.on("console", lambda m: console_fh.write(f"[{m.type}] {m.text}\n"))

        user_id = await restore_session(page)
        if not user_id:
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: /vote never rendered OAT board: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1200)

        # Tier guard — only run when the account starts as non-Pro.
        sec = await oat_section(page)
        cta = sec.get_by_title(f"{OAT_HEADING} — Pro only")
        if await cta.count() == 0:
            print("SKIP: signed-in account is already Pro; upgrade flow not exercisable.", file=sys.stderr)
            return 2

        # Scroll the OAT board into view and remember the scroll position.
        await sec.scroll_into_view_if_needed()
        await page.wait_for_timeout(300)
        scroll_before = await page.evaluate("window.scrollY")
        await page.screenshot(path=str(before_png))

        # 1) Click the lock CTA. It links to /pricing.
        await cta.first.click()
        try:
            await page.wait_for_url("**/pricing", timeout=8000)
        except Exception as e:
            print(f"FAIL: clicking lock CTA did not navigate to /pricing: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(600)
        await page.screenshot(path=str(pricing_png))

        results: dict = {
            "user_id": user_id,
            "scroll_before": scroll_before,
            "errors": [],
        }

        # 2) Apply the Pro fixture (simulated checkout completion).
        upgrade_status, upgrade_body = patch_subscription(sb_url, service_key, user_id, "pro_annual")
        results["upgrade_status"] = upgrade_status
        if not (200 <= upgrade_status < 300):
            print(f"FAIL: pro-fixture PATCH failed {upgrade_status}: {upgrade_body[:200]}", file=sys.stderr)
            return 1

        try:
            # 3) Return to /vote. Use browser back so scroll-memory restores
            # the OAT viewport position the user came from.
            await page.go_back(wait_until="domcontentloaded")
            await page.wait_for_url("**/vote", timeout=8000)
            # Force a hard reload so the auth/isPro query picks up the new
            # subscription tier — real checkout would trigger this via the
            # Supabase webhook + invalidate().
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=15000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(after_png))

            sec2 = await oat_section(page)
            cta_after = await sec2.get_by_title(f"{OAT_HEADING} — Pro only").count()
            up_after = await sec2.get_by_role("button", name="Vote up").count()
            down_after = await sec2.get_by_role("button", name="Vote down").count()
            box = await sec2.bounding_box()
            viewport_h = await page.evaluate("window.innerHeight")
            visible = bool(box) and box["y"] < viewport_h and (box["y"] + box["height"]) > 0
            scroll_after = await page.evaluate("window.scrollY")

            results.update({
                "lock_ctas_after": cta_after,
                "up_chevrons_after": up_after,
                "down_chevrons_after": down_after,
                "oat_visible_after": visible,
                "scroll_after": scroll_after,
            })

            if cta_after != 0:
                results["errors"].append(f"OAT lock CTA still rendered after upgrade (count={cta_after})")
            if up_after == 0 or down_after == 0:
                results["errors"].append(f"OAT chevrons missing after upgrade (up={up_after}, down={down_after})")
            if not visible:
                results["errors"].append("OAT board is not on-screen after returning from /pricing")
        finally:
            # 4) Always revert the fixture so the user's tier is restored.
            revert_status, _ = patch_subscription(sb_url, service_key, user_id, "free")
            results["revert_status"] = revert_status

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: OAT lock cleared post-upgrade and OAT category stayed on-screen.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
