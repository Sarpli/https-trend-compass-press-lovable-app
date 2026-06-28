#!/usr/bin/env python3
"""Stress test: heavy realtime voting bursts vs. ticker smoothness.

Loads the home page with the `?stress=1` test hook so the QueryClient is
exposed on `window.__qc`. Installs a requestAnimationFrame monitor plus a
PerformanceObserver for long tasks, then bursts ~200 ticker-cache
invalidations over ~10s — the exact code path our Supabase realtime
subscription triggers on each `vote_events` INSERT. Measures frame
intervals and long-task durations during the burst and fails if the
ticker animation degrades past the configured thresholds.

    python3 tests/ticker_stress.py

Env overrides:
  BASE_URL              default http://localhost:8080
  STRESS_DURATION_MS    default 10000
  STRESS_BURSTS         default 200    (invalidations spread across duration)
  STRESS_P95_MS         default 40     (frame-interval p95 threshold)
  STRESS_MAX_MS         default 180    (worst-case frame interval allowed)
  STRESS_LONGTASK_MS    default 1200   (total long-task time allowed)
  STRESS_ARTIFACT_DIR   default /tmp/ticker-stress-artifacts
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
DURATION_MS = int(os.environ.get("STRESS_DURATION_MS", "10000"))
BURSTS = int(os.environ.get("STRESS_BURSTS", "200"))
P95_MS = float(os.environ.get("STRESS_P95_MS", "40"))
MAX_MS = float(os.environ.get("STRESS_MAX_MS", "180"))
LONGTASK_BUDGET_MS = float(os.environ.get("STRESS_LONGTASK_MS", "1200"))
ARTIFACT_DIR = Path(os.environ.get("STRESS_ARTIFACT_DIR", "/tmp/ticker-stress-artifacts"))

INSTRUMENT_JS = """
() => {
  window.__frames = [];
  window.__longtasks = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longtasks.push({ duration: e.duration, start: e.startTime });
      }
    });
    obs.observe({ type: 'longtask', buffered: true });
    window.__lto = obs;
  } catch {}
}
"""

STOP_JS = """
() => {
  cancelAnimationFrame(window.__raf);
  try { window.__lto?.disconnect(); } catch {}
  return { frames: window.__frames, longtasks: window.__longtasks };
}
"""

BURST_JS = """
async ({ bursts, duration }) => {
  const qc = window.__qc;
  if (!qc) throw new Error('window.__qc missing — load page with ?stress=1');
  const gap = Math.max(1, Math.floor(duration / bursts));
  for (let i = 0; i < bursts; i++) {
    qc.invalidateQueries({ queryKey: ['ticker'] });
    // Occasionally fan out to the other queries the real subscription touches.
    if (i % 4 === 0) qc.invalidateQueries({ queryKey: ['leaderboard'] });
    if (i % 6 === 0) qc.invalidateQueries({ queryKey: ['trend-history'] });
    await new Promise((r) => setTimeout(r, gap));
  }
}
"""


def percentile(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1)))))
    return float(s[k])


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    console_log = ARTIFACT_DIR / "console.log"
    summary_path = ARTIFACT_DIR / "stress-summary.json"
    screenshot_path = ARTIFACT_DIR / "final.png"
    console_fh = console_log.open("w")

    async with async_playwright() as pw:
        # Disable Chromium's background throttling so rAF runs at the
        # display rate even in headless CI — otherwise frames are
        # capped to ~6fps and the test can't measure smoothness.
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--disable-features=CalculateNativeWinOcclusion",
            ],
        )
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()
        await page.bring_to_front()
        page.on("console", lambda msg: console_fh.write(f"[{msg.type}] {msg.text}\n"))
        page.on("pageerror", lambda exc: console_fh.write(f"[pageerror] {exc}\n"))

        try:
            await page.goto(f"{BASE_URL}/?stress=1", wait_until="domcontentloaded")
            # Wait for the ticker to mount and the test hook to attach.
            await page.wait_for_function("() => !!window.__qc", timeout=15000)
            await page.wait_for_selector(".ticker-bar", timeout=15000)
            # Let initial paint settle so we don't count first-load frames.
            await page.wait_for_timeout(1200)
            await page.evaluate(INSTRUMENT_JS)
            await page.evaluate(BURST_JS, {"bursts": BURSTS, "duration": DURATION_MS})
            # Cool-down to capture any tail jank from in-flight refetches.
            await page.wait_for_timeout(600)
            result = await page.evaluate(STOP_JS)
            await page.screenshot(path=str(screenshot_path))
        finally:
            await browser.close()
            console_fh.close()

    frames = [float(x) for x in result.get("frames", []) if x and x > 0]
    longtasks = result.get("longtasks", [])
    # Drop the first couple of frames — they always reflect rAF clock alignment.
    frames = frames[2:]
    p50 = percentile(frames, 50)
    p95 = percentile(frames, 95)
    p99 = percentile(frames, 99)
    worst = max(frames) if frames else 0.0
    longtask_total = sum(float(t["duration"]) for t in longtasks)
    longtask_max = max((float(t["duration"]) for t in longtasks), default=0.0)

    summary = {
        "duration_ms": DURATION_MS,
        "bursts": BURSTS,
        "frame_count": len(frames),
        "frame_ms_p50": p50,
        "frame_ms_p95": p95,
        "frame_ms_p99": p99,
        "frame_ms_max": worst,
        "longtask_count": len(longtasks),
        "longtask_total_ms": longtask_total,
        "longtask_max_ms": longtask_max,
        "thresholds": {
            "frame_ms_p95": P95_MS,
            "frame_ms_max": MAX_MS,
            "longtask_total_ms": LONGTASK_BUDGET_MS,
        },
    }
    summary_path.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"Artifacts written to {ARTIFACT_DIR}")

    failures = []
    if len(frames) < 60:
        failures.append(f"only {len(frames)} frames captured (rAF stalled)")
    if p95 > P95_MS:
        failures.append(f"frame p95 {p95:.1f}ms > {P95_MS}ms")
    if worst > MAX_MS:
        failures.append(f"worst frame {worst:.1f}ms > {MAX_MS}ms")
    if longtask_total > LONGTASK_BUDGET_MS:
        failures.append(
            f"long-task total {longtask_total:.0f}ms > {LONGTASK_BUDGET_MS:.0f}ms"
        )

    if failures:
        print("FAIL: ticker stress regressions:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(
        f"PASS: ticker stayed smooth under {BURSTS} invalidations "
        f"(p95={p95:.1f}ms, max={worst:.1f}ms, longtasks={longtask_total:.0f}ms)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))