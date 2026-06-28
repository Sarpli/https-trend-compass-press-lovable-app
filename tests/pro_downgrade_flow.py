#!/usr/bin/env python3
"""E2E: signed-in Pro user is downgraded mid-session via a subscription
fixture, and the OAT board immediately replaces vote chevrons with the
🔒 Pro lock CTA. No /rest/v1/votes writes may fire from any click or
hotkey on the gated board.

Flow:
  1. Restore the injected Supabase session and open /vote.
  2. Tier guard — require the account to start as Pro (OAT shows chevrons,
     no lock CTA). If the account is already free, skip with code 2.
  3. PATCH the user's subscriptions row to `free / active` via Supabase
     REST using PRO_FIXTURE_SERVICE_KEY.
  4. Reload /vote so the auth/isPro query picks up the new tier.
  5. Assert OAT now renders the 🔒 lock CTA and zero Vote up/down chevrons.
  6. Click every OAT lock CTA, focus each and fire Enter/Space/ArrowUp/
     ArrowDown/U/D/K/J/+/- hotkeys, then fire the same hotkeys with the
     body focused. Every navigation to /pricing is bounced back to /vote
     so the gated board stays mounted for the full hotkey sweep.
  7. Assert exactly zero `2xx /rest/v1/votes` writes from steps 5-6.
  8. finally: revert the subscription to `pro_annual / active`.

Required env (same as pro_upgrade_flow.py):
  * LOVABLE_BROWSER_SUPABASE_SESSION_JSON / _STORAGE_KEY (injected session)
  * PRO_FIXTURE_SERVICE_KEY  — service-role key for the Data API
  * Optional: SUPABASE_URL or VITE_SUPABASE_URL (auto-detected from .env)

Exit codes: 0 pass, 1 fail, 2 skip (missing session/key, or account is
already free so the downgrade flow isn't exercisable).

    python3 tests/pro_downgrade_flow.py

Env: BASE_URL, PRO_DOWNGRADE_ARTIFACT_DIR.
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
ARTIFACT_DIR = Path(os.environ.get("PRO_DOWNGRADE_ARTIFACT_DIR", "/tmp/pro-downgrade-artifacts"))

OAT_HEADING = "Trend of All Time"
HOTKEYS = ("Enter", " ", "ArrowUp", "ArrowDown", "u", "d", "k", "j", "+", "-")


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


async def oat_section(page):
    return page.get_by_role("heading", name=OAT_HEADING).locator("xpath=ancestor::section[1]")


async def bounce_back_if_on_pricing(page) -> None:
    """Pricing is a client-side TanStack route, so we can't intercept it
    with page.route. Instead, after each interaction that might navigate,
    snap the URL back to /vote so the gated board stays mounted."""
    if "/pricing" in page.url:
        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(400)


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "pro-downgrade-summary.json"
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    before_png = ARTIFACT_DIR / "before-pro.png"
    after_png = ARTIFACT_DIR / "after-downgrade.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    sb_url = supabase_url()
    service_key = os.environ.get("PRO_FIXTURE_SERVICE_KEY")
    if not (sb_url and service_key):
        print("SKIP: PRO_FIXTURE_SERVICE_KEY (and SUPABASE_URL) required.", file=sys.stderr)
        return 2

    vote_writes: list[dict] = []
    # Tagged per-phase so a failure points at the exact action.
    current_phase = {"name": "setup"}

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
                vote_writes.append({
                    "phase": current_phase["name"],
                    "status": resp.status,
                    "method": method,
                    "url": url,
                })

        page.on("response", on_response)

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
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(before_png))

        # Tier guard — only run when the account starts Pro.
        sec = await oat_section(page)
        lock_before = await sec.get_by_title(f"{OAT_HEADING} — Pro only").count()
        up_before = await sec.get_by_role("button", name="Vote up").count()
        if lock_before != 0 or up_before == 0:
            print(
                f"SKIP: signed-in account is not Pro on OAT "
                f"(lock={lock_before}, up_chevrons={up_before}); downgrade flow not exercisable.",
                file=sys.stderr,
            )
            return 2

        results: dict = {
            "user_id": user_id,
            "pre_downgrade": {"oat_lock": lock_before, "oat_up_chevrons": up_before},
            "errors": [],
        }

        # 1) Downgrade.
        current_phase["name"] = "downgrade-patch"
        down_status, down_body = patch_subscription(sb_url, service_key, user_id, "free")
        results["downgrade_status"] = down_status
        if not (200 <= down_status < 300):
            print(f"FAIL: downgrade PATCH failed {down_status}: {down_body[:200]}", file=sys.stderr)
            return 1

        try:
            # 2) Reload so isPro re-resolves.
            current_phase["name"] = "reload"
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_role("heading", name=OAT_HEADING).wait_for(timeout=15000)
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(after_png))

            sec2 = await oat_section(page)
            lock_after = sec2.get_by_title(f"{OAT_HEADING} — Pro only")
            lock_count = await lock_after.count()
            up_after = await sec2.get_by_role("button", name="Vote up").count()
            down_after = await sec2.get_by_role("button", name="Vote down").count()
            results["post_downgrade"] = {
                "oat_lock_ctas": lock_count,
                "oat_up_chevrons": up_after,
                "oat_down_chevrons": down_after,
            }

            # 3) Structural assertions: lock present, chevrons gone.
            if lock_count == 0:
                results["errors"].append(
                    "OAT lock CTA not rendered after downgrade — vote chevrons may still be live."
                )
            if up_after != 0 or down_after != 0:
                results["errors"].append(
                    f"OAT still renders vote chevrons after downgrade "
                    f"(up={up_after}, down={down_after}) — gating did not apply."
                )

            # Snapshot vote writes that landed during reload (must be 0).
            current_phase["name"] = "click-locks"
            click_baseline = len(vote_writes)

            # 4) Click every lock CTA on the OAT board. Bounce back from /pricing
            # after each click so we stay on the gated board.
            for i in range(lock_count):
                target = lock_after.nth(i)
                try:
                    await target.scroll_into_view_if_needed()
                    await target.click()
                    await page.wait_for_timeout(400)
                except Exception as e:
                    results["errors"].append(f"lock CTA click[{i}] threw: {e}")
                await bounce_back_if_on_pricing(page)
                # Re-resolve section after potential navigation.
                sec2 = await oat_section(page)
                lock_after = sec2.get_by_title(f"{OAT_HEADING} — Pro only")

            results["clicks_fired"] = lock_count
            results["writes_during_clicks"] = vote_writes[click_baseline:]

            # 5) Focused-hotkey sweep: focus each lock CTA and try every
            # plausible vote hotkey. None may fire a write.
            current_phase["name"] = "focused-hotkeys"
            hotkey_baseline = len(vote_writes)
            sec2 = await oat_section(page)
            lock_after = sec2.get_by_title(f"{OAT_HEADING} — Pro only")
            ctas_to_probe = await lock_after.count()
            for i in range(ctas_to_probe):
                target = lock_after.nth(i)
                try:
                    await target.focus()
                except Exception:
                    pass
                for k in HOTKEYS:
                    try:
                        await page.keyboard.press(k)
                    except Exception:
                        pass
                    await page.wait_for_timeout(40)
                    await bounce_back_if_on_pricing(page)

            # 6) Body-focused hotkey sweep.
            current_phase["name"] = "body-hotkeys"
            await page.evaluate("document.body.focus()")
            for k in HOTKEYS:
                try:
                    await page.keyboard.press(k)
                except Exception:
                    pass
                await page.wait_for_timeout(40)
                await bounce_back_if_on_pricing(page)

            results["writes_during_hotkeys"] = vote_writes[hotkey_baseline:]

            # 7) Hard assertion: zero vote mutations across all gated phases.
            gated_writes = [w for w in vote_writes if w["phase"] != "setup"]
            results["gated_phase_writes"] = gated_writes
            if gated_writes:
                results["errors"].append(
                    f"{len(gated_writes)} /rest/v1/votes writes fired on gated OAT "
                    f"after downgrade: {gated_writes}"
                )
        finally:
            # 8) Restore the user's Pro tier no matter what.
            current_phase["name"] = "revert"
            revert_status, _ = patch_subscription(sb_url, service_key, user_id, "pro_annual")
            results["revert_status"] = revert_status

        summary_path.write_text(json.dumps(results, indent=2))
        console_fh.close()
        network_fh.close()
        await browser.close()

    print(json.dumps(results, indent=2))
    if results["errors"]:
        for e in results["errors"]:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: post-downgrade OAT shows lock CTA only; zero vote mutations fired.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))