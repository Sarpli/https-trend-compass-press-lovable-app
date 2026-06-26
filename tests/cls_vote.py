#!/usr/bin/env python3
"""CLS regression check for voting on a term page.

Loads /trends/<slug>, restores the injected Lovable Supabase session
(if present), then records every layout-shift entry via
PerformanceObserver while clicking the up/down vote buttons several
times. Fails if the cumulative score exceeds CLS_THRESHOLD.

    python3 tests/cls_vote.py

Env overrides: BASE_URL, TERM_SLUG, CLS_THRESHOLD, VOTE_CLICKS.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
TERM_SLUG = os.environ.get("TERM_SLUG", "67")
CLS_THRESHOLD = float(os.environ.get("CLS_THRESHOLD", "0.05"))
VOTE_CLICKS = int(os.environ.get("VOTE_CLICKS", "6"))
ARTIFACT_DIR = Path(os.environ.get("CLS_ARTIFACT_DIR", "/tmp/cls-artifacts"))

SEQUENCE = ["up", "down", "up", "up", "down", "down"]

OBSERVER_JS = """
() => {
  window.__cls = 0;
  window.__shifts = [];
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__cls += entry.value;
      window.__shifts.push({ value: entry.value, time: entry.startTime });
    }
  });
  obs.observe({ type: 'layout-shift', buffered: true });
}
"""


async def main() -> int:
    session = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    console_log = ARTIFACT_DIR / "console.log"
    network_log = ARTIFACT_DIR / "network.log"
    trace_path = ARTIFACT_DIR / "trace.zip"
    summary_path = ARTIFACT_DIR / "cls-summary.json"
    screenshot_path = ARTIFACT_DIR / "final.png"
    console_fh = console_log.open("w")
    network_fh = network_log.open("w")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        await context.tracing.start(screenshots=True, snapshots=True, sources=True)
        page = await context.new_page()
        page.on("console", lambda msg: console_fh.write(f"[{msg.type}] {msg.text}\n"))
        page.on("pageerror", lambda exc: console_fh.write(f"[pageerror] {exc}\n"))
        page.on("request", lambda req: network_fh.write(f"> {req.method} {req.url}\n"))
        page.on(
            "response",
            lambda res: network_fh.write(f"< {res.status} {res.url}\n"),
        )

        # Land on the term page directly; restoring the session requires the
        # localhost origin, so we set it after the first goto via evaluate
        # and then navigate to the same URL again via client-side router.
        try:
            await page.goto(f"{BASE_URL}/trends/{TERM_SLUG}", wait_until="domcontentloaded")
            if storage_key and session:
                await page.evaluate(
                    f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session)})"
                )
                await page.reload(wait_until="domcontentloaded")
            await page.wait_for_selector('button[aria-label="Vote up"]', timeout=15000)
            # Scroll vote buttons into view BEFORE we start measuring CLS,
            # so the scroll itself isn't counted (it wouldn't be — scrolls
            # don't generate layout-shift entries — but the chart finishing
            # render after scroll might).
            await page.locator('button[aria-label="Vote up"]').first.scroll_into_view_if_needed()
            await page.wait_for_timeout(400)
            await page.evaluate(OBSERVER_JS)

            # Let initial paint + chart settle, then reset the score.
            await page.wait_for_timeout(800)
            await page.evaluate("() => { window.__cls = 0; window.__shifts = []; }")

            up_btns = page.locator('button[aria-label="Vote up"]')
            down_btns = page.locator('button[aria-label="Vote down"]')
            if await up_btns.count() == 0:
                print("FAIL: no vote-up buttons found on term page", file=sys.stderr)
                await context.tracing.stop(path=str(trace_path))
                await browser.close()
                console_fh.close()
                network_fh.close()
                return 1

            for i in range(VOTE_CLICKS):
                direction = SEQUENCE[i % len(SEQUENCE)]
                target = (up_btns if direction == "up" else down_btns).first
                await target.click(force=True)
                await page.wait_for_timeout(450)

            await page.wait_for_timeout(600)

            result = await page.evaluate(
                "() => ({ cls: window.__cls, shifts: window.__shifts })"
            )
            await page.screenshot(path=str(screenshot_path))
        finally:
            await context.tracing.stop(path=str(trace_path))
            await browser.close()
            console_fh.close()
            network_fh.close()

    cls = float(result["cls"])
    shifts = result["shifts"]
    summary_path.write_text(
        json.dumps(
            {
                "cls": cls,
                "threshold": CLS_THRESHOLD,
                "votes": VOTE_CLICKS,
                "sequence": SEQUENCE[:VOTE_CLICKS],
                "slug": TERM_SLUG,
                "shifts": shifts,
            },
            indent=2,
        )
    )
    print(f"CLS after {VOTE_CLICKS} votes: {cls:.5f} (threshold {CLS_THRESHOLD})")
    print(f"Artifacts written to {ARTIFACT_DIR}")
    if shifts:
        print(f"Shift entries ({len(shifts)}):")
        for s in shifts:
            print(f"  +{s['value']:.5f} @ {s['time']:.0f}ms")

    if cls > CLS_THRESHOLD:
        print(f"FAIL: voting caused layout shift {cls:.5f} > {CLS_THRESHOLD}", file=sys.stderr)
        return 1
    print(f"PASS: voting kept CLS at {cls:.5f} (<= {CLS_THRESHOLD}).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))