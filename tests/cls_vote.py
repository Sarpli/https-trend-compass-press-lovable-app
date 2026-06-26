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

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
TERM_SLUG = os.environ.get("TERM_SLUG", "67")
CLS_THRESHOLD = float(os.environ.get("CLS_THRESHOLD", "0.05"))
VOTE_CLICKS = int(os.environ.get("VOTE_CLICKS", "6"))

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

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()

        await page.goto(BASE_URL, wait_until="domcontentloaded")
        if storage_key and session:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session)})"
            )

        await page.goto(f"{BASE_URL}/trends/{TERM_SLUG}", wait_until="domcontentloaded")
        await page.wait_for_selector('button[aria-label="Vote up"]', timeout=15000)
        await page.evaluate(OBSERVER_JS)

        # Let initial paint + chart settle, then reset the score.
        await page.wait_for_timeout(800)
        await page.evaluate("() => { window.__cls = 0; window.__shifts = []; }")

        up_btns = page.locator('button[aria-label="Vote up"]')
        down_btns = page.locator('button[aria-label="Vote down"]')
        if await up_btns.count() == 0:
            print("FAIL: no vote-up buttons found on term page", file=sys.stderr)
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
        await browser.close()

    cls = float(result["cls"])
    shifts = result["shifts"]
    print(f"CLS after {VOTE_CLICKS} votes: {cls:.5f} (threshold {CLS_THRESHOLD})")
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