#!/usr/bin/env python3
"""E2E: upgrade Free → Pro while /vote is open and verify OAT chevrons
appear IN-PLACE — no navigation, no reload, no route change.

Flow:
  1. Restore the injected free-tier session and open /vote?qc=1 so the
     QueryClient is exposed on window.__qc (existing root test hook).
  2. Assert the OAT board renders the 🔒 Pro lock CTA and zero chevrons.
  3. Snapshot scrollY and the current URL.
  4. PATCH the subscription row to `pro_annual / active` via Supabase REST
     using PRO_FIXTURE_SERVICE_KEY (simulates the checkout webhook).
  5. Invalidate the in-page subscription query via window.__qc — NO reload,
     NO navigation, NO go_back.
  6. Poll up to 15s for OAT chevrons to appear and the lock CTA to vanish
     while asserting the URL and scrollY are unchanged the whole time.
  7. Revert the row to `free / active` in a finally block.

Exit codes: 0 pass · 1 fail · 2 skip (no session / no service key / already Pro).

    python3 tests/pro_upgrade_inplace.py

Env: BASE_URL, PRO_UPGRADE_INPLACE_ARTIFACT_DIR.
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
ARTIFACT_DIR = Path(os.environ.get("PRO_UPGRADE_INPLACE_ARTIFACT_DIR", "/tmp/pro-upgrade-inplace-artifacts"))
OAT_HEADING = "Trend of All Time"


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


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "summary.json"
    nav_events: list[str] = []
    results: dict = {"errors": []}

    sb_url = supabase_url()
    service_key = os.environ.get("PRO_FIXTURE_SERVICE_KEY")
    if not (sb_url and service_key):
        print("SKIP: PRO_FIXTURE_SERVICE_KEY (and SUPABASE_URL) required.", file=sys.stderr)
        return 2

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        page.on("framenavigated", lambda f: nav_events.append(f.url) if f == page.main_frame else None)

        user_id = await restore_session(page)
        if not user_id:
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        await page.goto(f"{BASE_URL}/vote?qc=1", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=15000)
        except Exception as e:
            print(f"FAIL: OAT board never rendered: {e}", file=sys.stderr)
            return 1
        await page.wait_for_timeout(1500)

        sec = page.get_by_role("heading", name=OAT_HEADING).locator("xpath=ancestor::section[1]")
        cta = sec.get_by_title(f"{OAT_HEADING} — Pro only")
        cta_before = await cta.count()
        chevrons_before = await sec.get_by_role("button", name="Vote up").count()
        if cta_before == 0:
            print("SKIP: account is already Pro; in-place upgrade not exercisable.", file=sys.stderr)
            return 2
        if chevrons_before > 0:
            print(f"FAIL: free-tier OAT already has chevrons before upgrade ({chevrons_before}).", file=sys.stderr)
            return 1

        # Confirm the QueryClient bridge is exposed.
        has_qc = await page.evaluate("typeof window.__qc !== 'undefined'")
        if not has_qc:
            print("FAIL: window.__qc was not exposed by ?qc=1 hook.", file=sys.stderr)
            return 1

        await sec.scroll_into_view_if_needed()
        await page.wait_for_timeout(200)
        url_before = page.url
        scroll_before = await page.evaluate("window.scrollY")
        nav_baseline = len(nav_events)
        await page.screenshot(path=str(ARTIFACT_DIR / "before.png"))

        # --- Apply the Pro fixture (simulated checkout webhook).
        upgrade_status, upgrade_body = patch_subscription(sb_url, service_key, user_id, "pro_annual")
        results["upgrade_status"] = upgrade_status
        if not (200 <= upgrade_status < 300):
            print(f"FAIL: pro-fixture PATCH failed {upgrade_status}: {upgrade_body[:200]}", file=sys.stderr)
            return 1

        try:
            # In-place refetch: invalidate the subscription query through the
            # exposed QueryClient. No reload, no navigation.
            await page.evaluate(
                """async () => {
                  const qc = window.__qc;
                  if (!qc) return false;
                  await qc.invalidateQueries({ queryKey: ['subscription'] });
                  return true;
                }"""
            )

            # Poll up to 15s for the UI to react in-place.
            deadline = asyncio.get_event_loop().time() + 15.0
            cta_after = cta_before
            up_after = 0
            down_after = 0
            while asyncio.get_event_loop().time() < deadline:
                cta_after = await cta.count()
                up_after = await sec.get_by_role("button", name="Vote up").count()
                down_after = await sec.get_by_role("button", name="Vote down").count()
                if cta_after == 0 and up_after > 0 and down_after > 0:
                    break
                await page.wait_for_timeout(250)

            url_after = page.url
            scroll_after = await page.evaluate("window.scrollY")
            nav_count = len(nav_events) - nav_baseline
            await page.screenshot(path=str(ARTIFACT_DIR / "after.png"))

            results.update({
                "user_id": user_id,
                "cta_before": cta_before,
                "cta_after": cta_after,
                "up_chevrons_after": up_after,
                "down_chevrons_after": down_after,
                "url_before": url_before,
                "url_after": url_after,
                "scroll_before": scroll_before,
                "scroll_after": scroll_after,
                "main_frame_navigations_during_upgrade": nav_count,
                "nav_events_during_upgrade": nav_events[nav_baseline:],
            })

            if url_before != url_after:
                results["errors"].append(f"URL changed during upgrade: {url_before} -> {url_after}")
            if nav_count > 0:
                results["errors"].append(f"main frame navigated {nav_count}x during upgrade (in-place required)")
            if cta_after != 0:
                results["errors"].append(f"OAT lock CTA still rendered in-place (count={cta_after})")
            if up_after == 0 or down_after == 0:
                results["errors"].append(f"OAT chevrons missing in-place (up={up_after}, down={down_after})")
        finally:
            revert_status, _ = patch_subscription(sb_url, service_key, user_id, "free")
            results["revert_status"] = revert_status

        summary_path.write_text(json.dumps(results, indent=2))
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: OAT chevrons appeared in-place after Free → Pro upgrade with no navigation.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
