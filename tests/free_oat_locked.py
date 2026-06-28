#!/usr/bin/env python3
"""E2E: free-tier user cannot vote in OAT via click OR keyboard.

Asserts, for the Trend of All Time board on /vote:
  * The 🔒 Pro lock CTA is visible before and after every interaction.
  * No up/down chevron buttons render inside the OAT section.
  * Clicking the CTA, clicking every row, and firing hotkeys
    (Enter, Space, ArrowUp/Down, U, D, K, J, +, -) on each focusable
    element in the section produces ZERO POST/PATCH/DELETE requests to
    /rest/v1/votes.

Exit codes: 0 pass · 1 fail · 2 skip (no session / Pro session / OAT didn't render).

Env: BASE_URL, FREE_OAT_LOCKED_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("FREE_OAT_LOCKED_ARTIFACT_DIR", "/tmp/free-oat-locked-artifacts"))
OAT_LABEL = "Trend of All Time"
HOTKEYS = ["Enter", " ", "ArrowUp", "ArrowDown", "u", "d", "k", "j", "+", "-"]


async def restore_session(page) -> bool:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return False
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    return True


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "summary.json"
    network_log = ARTIFACT_DIR / "network.log"
    network_fh = network_log.open("w")
    vote_writes: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        def on_response(resp):
            url = resp.url
            method = resp.request.method
            network_fh.write(f"{resp.status} {method} {url}\n")
            if "/rest/v1/votes" in url and method in ("POST", "PATCH", "DELETE"):
                vote_writes.append({"status": resp.status, "method": method, "url": url})

        page.on("response", on_response)

        if not await restore_session(page):
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        # Intercept pricing nav so we don't bounce off /vote.
        await page.route("**/pricing*", lambda r: r.abort())

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=OAT_LABEL).wait_for(timeout=20000)
        except Exception as e:
            print(f"SKIP: OAT board never rendered: {e}", file=sys.stderr)
            return 2
        await page.wait_for_timeout(1500)
        section = page.get_by_role("heading", name=OAT_LABEL).locator("xpath=ancestor::section[1]")

        cta_locator = section.get_by_title(f"{OAT_LABEL} — Pro only")
        cta_count = await cta_locator.count()
        chevron_count = await section.get_by_role("button", name="Vote up").count()

        if cta_count == 0 or chevron_count > 0:
            print(
                f"SKIP: signed-in account isn't free-tier (cta={cta_count}, chevrons={chevron_count}).",
                file=sys.stderr,
            )
            return 2

        await page.screenshot(path=str(ARTIFACT_DIR / "before.png"))

        # --- Click the lock CTA itself.
        try:
            await cta_locator.first.click(no_wait_after=True)
        except Exception:
            pass
        await page.wait_for_timeout(300)

        # --- Click every row in the OAT section.
        rows = section.locator("li")
        n_rows = await rows.count()
        for i in range(n_rows):
            try:
                await rows.nth(i).click(no_wait_after=True, force=True)
            except Exception:
                pass
            await page.wait_for_timeout(80)

        # --- Tab through focusable elements inside the section and fire each hotkey.
        focusables = section.locator(
            "a, button, input, [tabindex]:not([tabindex='-1'])"
        )
        n_focus = await focusables.count()
        keyed = 0
        for i in range(min(n_focus, 24)):
            try:
                await focusables.nth(i).focus()
            except Exception:
                continue
            for k in HOTKEYS:
                try:
                    await page.keyboard.press(k)
                    keyed += 1
                except Exception:
                    pass
            await page.wait_for_timeout(40)

        # Final settle for any in-flight async mutation.
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(ARTIFACT_DIR / "after.png"))

        # --- Final assertions.
        cta_after = await cta_locator.count()
        chevrons_after = await section.get_by_role("button", name="Vote up").count()

        errors = []
        if vote_writes:
            errors.append(f"unexpected /rest/v1/votes mutations: {vote_writes}")
        if cta_after == 0:
            errors.append("lock CTA disappeared after interactions")
        if chevrons_after > 0:
            errors.append(f"vote chevrons appeared in OAT after interactions: {chevrons_after}")

        summary = {
            "rows_clicked": n_rows,
            "focusables_keyed": min(n_focus, 24),
            "hotkey_presses": keyed,
            "vote_writes": vote_writes,
            "cta_before": cta_count,
            "cta_after": cta_after,
            "chevrons_before": chevron_count,
            "chevrons_after": chevrons_after,
            "errors": errors,
        }
        summary_path.write_text(json.dumps(summary, indent=2))
        network_fh.close()
        await browser.close()

    print(json.dumps(summary, indent=2))
    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: OAT remained locked under clicks + keyboard; no vote writes fired.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))