#!/usr/bin/env python3
"""Simulate a device sleeping mid-day and resuming, possibly past local
midnight, and confirm that the spotlight + 6 front-page stories:

  1. Stay identical after a same-day resume (clock jumps forward several
     hours but the local calendar date is unchanged).
  2. Re-shuffle exactly once when the resume crosses the next local-
     midnight boundary.

The browser's wall clock is stubbed with a *mutable* `__FAKE_NOW` global
so the test can advance it at runtime, then dispatch the `focus` and
`visibilitychange` events that `useLocalDateKey` listens for. That mirrors
what happens on a real phone: `setTimeout`/`setInterval` callbacks drift
during sleep, and on resume the focus/visibility handlers re-sync the
local-date key and reschedule the midnight rollover.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACTS = Path(os.environ.get("SLEEP_RESUME_ARTIFACT_DIR", "/tmp/sleep-resume"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
TZ = "America/New_York"

# 2026-06-28T14:00:00Z = 10:00 EDT Jun 28 (mid-morning, plenty of room to
# jump forward without crossing midnight). EDT is UTC-4 in June.
START_ISO = "2026-06-28T14:00:00Z"

# Mutable-clock stub. `__FAKE_NOW` is writable from page.evaluate so the
# test can fast-forward the wall clock mid-session.
STUB_TEMPLATE = """
(() => {
  window.__FAKE_NOW = new Date('__ISO__').getTime();
  const RealDate = Date;
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new RealDate(window.__FAKE_NOW).toString();
    if (args.length === 0) return new RealDate(window.__FAKE_NOW);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => window.__FAKE_NOW;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  Object.setPrototypeOf(FakeDate, RealDate);
  window.Date = FakeDate;
})();
"""

SNAPSHOT_JS = """
() => {
  const h2 = document.querySelector('section h2');
  const spotlight = h2 ? h2.textContent.trim() : '';
  const grids = document.querySelectorAll('section .grid');
  let target = null;
  for (const g of grids) {
    const cls = g.className;
    if (cls.includes('grid-cols-1') && cls.includes('sm:grid-cols-2')
        && cls.includes('gap-6') && cls.includes('mt-8')) {
      target = g; break;
    }
  }
  const stories = target
    ? [...target.querySelectorAll('article h3')].map(h => h.textContent.trim())
    : [];
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year:'numeric', month:'2-digit', day:'2-digit'
  });
  return { spotlight, stories, localDate: fmt.format(new Date()) };
}
"""


def key(s):
    return (s["spotlight"], tuple(s["stories"]))


async def advance_and_resume(page, hours: float):
    """Fast-forward the page's mutable clock and fire the events that
    `useLocalDateKey` uses to detect a resume — `focus` and the
    visibility change. The hook's drift detector + onFocus handler
    immediately re-sync the local-date key and reschedule midnight."""
    await page.evaluate(
        "(ms) => { window.__FAKE_NOW += ms; }",
        int(hours * 3_600_000),
    )
    await page.evaluate(
        """() => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        }"""
    )
    # Give React's effect queue + query invalidations a tick to flush.
    await page.wait_for_timeout(800)


async def wait_for_stories(page):
    await page.wait_for_function(
        "() => document.querySelectorAll('article h3').length >= 6",
        timeout=20_000,
    )


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            timezone_id=TZ,
        )
        await context.add_init_script(STUB_TEMPLATE.replace("__ISO__", START_ISO))
        page = await context.new_page()
        await page.goto(f"{BASE_URL}/", wait_until="networkidle")
        await wait_for_stories(page)

        initial = await page.evaluate(SNAPSHOT_JS)
        await page.screenshot(path=str(ARTIFACTS / "1_initial.png"))
        print("initial:", initial)
        if initial["localDate"] != "2026-06-28":
            failures.append(f"initial localDate expected 2026-06-28, got {initial['localDate']}")
        if len(initial["stories"]) != 6:
            failures.append(f"initial expected 6 stories, got {len(initial['stories'])}")

        # --- Sleep #1: short nap, same local day. 10:00 -> 16:00 EDT.
        await advance_and_resume(page, hours=6)
        after_short = await page.evaluate(SNAPSHOT_JS)
        await page.screenshot(path=str(ARTIFACTS / "2_after_short_nap.png"))
        print("after_short:", after_short)
        if after_short["localDate"] != "2026-06-28":
            failures.append(f"short-nap localDate expected 2026-06-28, got {after_short['localDate']}")
        if key(after_short) != key(initial):
            failures.append("Short same-day resume changed spotlight/stories (must stay aligned).")

        # --- Sleep #2: long nap *within* same local day. 16:00 -> 22:00 EDT.
        await advance_and_resume(page, hours=6)
        after_evening = await page.evaluate(SNAPSHOT_JS)
        await page.screenshot(path=str(ARTIFACTS / "3_after_evening_nap.png"))
        print("after_evening:", after_evening)
        if after_evening["localDate"] != "2026-06-28":
            failures.append(f"evening-nap localDate expected 2026-06-28, got {after_evening['localDate']}")
        if key(after_evening) != key(initial):
            failures.append("Long same-day resume changed content before local midnight.")

        # --- Sleep #3: cross local midnight. 22:00 EDT Jun 28 -> 04:00 EDT Jun 29.
        await advance_and_resume(page, hours=6)
        after_midnight = await page.evaluate(SNAPSHOT_JS)
        await page.screenshot(path=str(ARTIFACTS / "4_after_midnight.png"))
        print("after_midnight:", after_midnight)
        if after_midnight["localDate"] != "2026-06-29":
            failures.append(f"post-midnight localDate expected 2026-06-29, got {after_midnight['localDate']}")
        if len(after_midnight["stories"]) != 6:
            failures.append(f"post-midnight expected 6 stories, got {len(after_midnight['stories'])}")
        if key(after_midnight) == key(initial):
            failures.append("Crossing local midnight did NOT re-shuffle spotlight/stories.")

        # --- Sleep #4: continue into Jun 29 mid-morning; must remain identical
        # to the just-flipped Jun 29 snapshot. 04:00 -> 11:00 EDT Jun 29.
        await advance_and_resume(page, hours=7)
        after_jun29_late = await page.evaluate(SNAPSHOT_JS)
        await page.screenshot(path=str(ARTIFACTS / "5_jun29_midmorning.png"))
        print("jun29_late:", after_jun29_late)
        if after_jun29_late["localDate"] != "2026-06-29":
            failures.append(f"jun29 late localDate expected 2026-06-29, got {after_jun29_late['localDate']}")
        if key(after_jun29_late) != key(after_midnight):
            failures.append("Same Jun 29 local day produced different content after another resume.")

        await browser.close()

    for f in failures:
        print("FAIL:", f, file=sys.stderr)
    if failures:
        return 1
    print("PASS: sleep/resume keeps spotlight+stories aligned until local midnight, then flips.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))