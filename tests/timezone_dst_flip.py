#!/usr/bin/env python3
"""Timezone + DST regression for the daily flip.

Confirms that the spotlight + 6 front-page stories key off the viewer's
LOCAL calendar date (not UTC) and that the flip happens at LOCAL midnight,
including across DST transitions where the local clock jumps an hour.

Scenarios:
  1. UTC-boundary straddle (Pacific/Kiritimati, UTC+14): an instant that is
     "tomorrow UTC" but the same local day as another UTC-yesterday instant
     must produce identical content.
  2. Same local day across multiple timezones each picks the day for ITS
     own zone (NYC and Sydney can be on different dates at the same instant
     and must each be internally consistent).
  3. America/New_York spring-forward (2026-03-08 02:00 -> 03:00 local):
     two UTC instants straddling the DST gap but both on local Mar 8 must
     produce identical content. Local Mar 7 vs Mar 8 must differ.
  4. America/New_York fall-back (2026-11-01 02:00 -> 01:00 local): the
     repeated 01:30 local hour still resolves to Nov 1 on both passes.
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACTS = Path(os.environ.get("DST_ARTIFACT_DIR", "/tmp/dst-flip"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

STUB_TEMPLATE = """
(() => {
  const FIXED = new Date('__ISO__').getTime();
  const RealDate = Date;
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new RealDate(FIXED).toString();
    if (args.length === 0) return new RealDate(FIXED);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => FIXED;
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
  // Also surface what the page thinks the local date is.
  const fmt = new Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit' });
  return { spotlight, stories, localDate: fmt.format(new Date()) };
}
"""


async def snapshot(pw, tz: str, iso: str, label: str) -> dict:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(
        viewport={"width": 1280, "height": 1800},
        timezone_id=tz,
    )
    await context.add_init_script(STUB_TEMPLATE.replace("__ISO__", iso))
    page = await context.new_page()
    await page.goto(f"{BASE_URL}/", wait_until="networkidle")
    await page.wait_for_function(
        "() => document.querySelectorAll('article h3').length >= 6",
        timeout=20_000,
    )
    snap = await page.evaluate(SNAPSHOT_JS)
    await page.screenshot(path=str(ARTIFACTS / f"{label}.png"))
    await browser.close()
    snap["label"] = label
    snap["tz"] = tz
    snap["iso"] = iso
    return snap


def key(s: dict) -> tuple:
    return (s["spotlight"], tuple(s["stories"]))


async def main() -> int:
    failures: list[str] = []
    async with async_playwright() as pw:
        # --- Scenario 1: UTC+14 straddle ---
        # 2026-06-28T14:00Z = 2026-06-29 04:00 local Kiritimati.
        # 2026-06-28T20:00Z = 2026-06-29 10:00 local Kiritimati. Same local day.
        # 2026-06-28T08:00Z = 2026-06-28 22:00 local Kiritimati. Different day.
        k1 = await snapshot(pw, "Pacific/Kiritimati", "2026-06-28T14:00:00Z", "kir_jun29_a")
        k2 = await snapshot(pw, "Pacific/Kiritimati", "2026-06-28T20:00:00Z", "kir_jun29_b")
        k0 = await snapshot(pw, "Pacific/Kiritimati", "2026-06-28T08:00:00Z", "kir_jun28")
        if k1["localDate"] != "2026-06-29" or k2["localDate"] != "2026-06-29":
            failures.append(f"Kiritimati local date wrong: {k1['localDate']} / {k2['localDate']}")
        if key(k1) != key(k2):
            failures.append("Kiritimati: same local day produced different spotlight/stories.")
        if key(k0) == key(k1):
            failures.append("Kiritimati: different local days produced identical content.")

        # --- Scenario 2: cross-timezone same instant ---
        # 2026-06-28T22:00Z -> NYC 18:00 Jun 28, Sydney 08:00 Jun 29.
        ny = await snapshot(pw, "America/New_York", "2026-06-28T22:00:00Z", "ny_jun28")
        syd = await snapshot(pw, "Australia/Sydney", "2026-06-28T22:00:00Z", "syd_jun29")
        if ny["localDate"] != "2026-06-28":
            failures.append(f"NYC localDate expected 2026-06-28, got {ny['localDate']}")
        if syd["localDate"] != "2026-06-29":
            failures.append(f"Sydney localDate expected 2026-06-29, got {syd['localDate']}")
        # They are on different local days, so content should differ.
        if key(ny) == key(syd):
            failures.append("NYC vs Sydney on different local dates produced identical content.")

        # --- Scenario 3: NYC spring-forward (2026-03-08) ---
        # 06:59Z = 01:59 EST (pre-jump), 07:01Z = 03:01 EDT (post-jump).
        pre = await snapshot(pw, "America/New_York", "2026-03-08T06:59:00Z", "nyc_spring_pre")
        post = await snapshot(pw, "America/New_York", "2026-03-08T07:01:00Z", "nyc_spring_post")
        prev_day = await snapshot(pw, "America/New_York", "2026-03-07T17:00:00Z", "nyc_mar7")
        if pre["localDate"] != "2026-03-08" or post["localDate"] != "2026-03-08":
            failures.append(f"NYC DST spring: localDate {pre['localDate']} / {post['localDate']}")
        if key(pre) != key(post):
            failures.append("NYC DST spring-forward: same local day produced different content.")
        if key(prev_day) == key(pre):
            failures.append("NYC: Mar 7 and Mar 8 produced identical content.")

        # --- Scenario 4: NYC fall-back (2026-11-01) ---
        # 05:30Z = 01:30 EDT (first pass), 06:30Z = 01:30 EST (second pass).
        fb1 = await snapshot(pw, "America/New_York", "2026-11-01T05:30:00Z", "nyc_fall_pre")
        fb2 = await snapshot(pw, "America/New_York", "2026-11-01T06:30:00Z", "nyc_fall_post")
        if fb1["localDate"] != "2026-11-01" or fb2["localDate"] != "2026-11-01":
            failures.append(f"NYC DST fall: localDate {fb1['localDate']} / {fb2['localDate']}")
        if key(fb1) != key(fb2):
            failures.append("NYC DST fall-back: repeated local hour produced different content.")

    for f in failures:
        print("FAIL:", f, file=sys.stderr)
    if failures:
        return 1
    print("PASS: daily flip is stable across timezones and DST transitions.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))