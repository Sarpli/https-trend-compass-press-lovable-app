#!/usr/bin/env python3
"""Verify the 6 front-page stories under the spotlight reshuffle
deterministically per local calendar day.

Strategy: stub the browser's `Date` constructor via an init script so
the page sees a fixed timestamp. Reload across three configurations:
  A: local date 2026-06-28
  B: local date 2026-06-29  (must differ from A)
  C: local date 2026-06-28  (must equal A)
"""
import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACTS = Path("/tmp/daily-stories")
ARTIFACTS.mkdir(parents=True, exist_ok=True)

# Noon UTC: same calendar date in America/New_York.
DATE_A_ISO = "2026-06-28T16:00:00Z"
DATE_B_ISO = "2026-06-29T16:00:00Z"

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

GET_STORIES_JS = """
() => {
  const grids = document.querySelectorAll('section .grid');
  let target = null;
  for (const g of grids) {
    const cls = g.className;
    if (cls.includes('grid-cols-1') && cls.includes('sm:grid-cols-2')
        && cls.includes('gap-6') && cls.includes('mt-8')) {
      target = g; break;
    }
  }
  if (!target) return [];
  return [...target.querySelectorAll('article h3')].map(h => h.textContent.trim());
}
"""


async def fetch_order(playwright, iso: str, label: str) -> list[str]:
    browser = await playwright.chromium.launch(headless=True)
    context = await browser.new_context(
        viewport={"width": 1280, "height": 1800},
        timezone_id="America/New_York",
    )
    await context.add_init_script(STUB_TEMPLATE.replace("__ISO__", iso))
    page = await context.new_page()
    await page.goto(f"{BASE_URL}/", wait_until="networkidle")
    # Wait for at least one story to render.
    await page.wait_for_function(
        "() => document.querySelectorAll('article h3').length >= 6",
        timeout=15_000,
    )
    stories = await page.evaluate(GET_STORIES_JS)
    await page.screenshot(path=str(ARTIFACTS / f"{label}.png"))
    await browser.close()
    return stories


async def main() -> int:
    async with async_playwright() as pw:
        order_a1 = await fetch_order(pw, DATE_A_ISO, "a1_jun28")
        order_b  = await fetch_order(pw, DATE_B_ISO, "b_jun29")
        order_a2 = await fetch_order(pw, DATE_A_ISO, "a2_jun28")

    print("A1:", order_a1)
    print("B :", order_b)
    print("A2:", order_a2)

    failures = []
    if len(order_a1) != 6:
        failures.append(f"A1 expected 6 stories, got {len(order_a1)}: {order_a1}")
    if len(order_b) != 6:
        failures.append(f"B expected 6 stories, got {len(order_b)}: {order_b}")
    if order_a1 != order_a2:
        failures.append("Non-deterministic: same local date produced different orders.")
    if order_a1 == order_b:
        failures.append("Did not reshuffle: distinct local dates produced identical orders.")

    if failures:
        for f in failures:
            print("FAIL:", f, file=sys.stderr)
        return 1
    print("PASS: stories reshuffle deterministically per local date.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
