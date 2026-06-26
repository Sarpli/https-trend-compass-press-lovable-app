#!/usr/bin/env node
/**
 * CLS regression check for voting on a term page.
 *
 * Loads /trends/67, restores the injected Supabase session if present,
 * records every layout-shift entry via PerformanceObserver while the
 * up/down vote buttons are clicked several times, and asserts the
 * cumulative score stays below CLS_THRESHOLD.
 *
 * Run:  node tests/cls-vote.mjs
 * Env:  BASE_URL (default http://localhost:8080), TERM_SLUG (default 67),
 *       CLS_THRESHOLD (default 0.05 — stricter than Google's 0.1 "Good").
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TERM_SLUG = process.env.TERM_SLUG ?? "67";
const CLS_THRESHOLD = Number(process.env.CLS_THRESHOLD ?? "0.05");
const VOTE_CLICKS = 6;

function fail(msg) {
  console.error(`\u001b[31mFAIL\u001b[0m ${msg}`);
  process.exit(1);
}
function pass(msg) {
  console.log(`\u001b[32mPASS\u001b[0m ${msg}`);
}

const session = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
if (storageKey && session) {
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k, v),
    [storageKey, session],
  );
}

await page.goto(`${BASE_URL}/trends/${TERM_SLUG}`, { waitUntil: "networkidle" });

// Install PerformanceObserver for layout-shift entries.
await page.evaluate(() => {
  window.__cls = 0;
  window.__shifts = [];
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // Ignore shifts caused by recent user input.
      // @ts-ignore
      if (entry.hadRecentInput) continue;
      // @ts-ignore
      window.__cls += entry.value;
      // @ts-ignore
      window.__shifts.push({ value: entry.value, time: entry.startTime });
    }
  });
  obs.observe({ type: "layout-shift", buffered: true });
});

// Wait for chart + initial paint to settle so the baseline CLS is clean.
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__cls = 0;
  window.__shifts = [];
});

const upBtns = page.locator('button[aria-label="Vote up"]');
const downBtns = page.locator('button[aria-label="Vote down"]');
const upCount = await upBtns.count();
if (upCount === 0) fail("No vote-up buttons found on term page.");

// Toggle votes on the first (week) row a few times — covers up, flip, down, untoggle.
const sequence = ["up", "down", "up", "up", "down", "down"];
for (let i = 0; i < VOTE_CLICKS; i++) {
  const dir = sequence[i % sequence.length];
  const target = (dir === "up" ? upBtns : downBtns).first();
  await target.click({ force: true });
  await page.waitForTimeout(450); // allow optimistic update + transitions
}

// Allow any debounced re-render to finish before reading the score.
await page.waitForTimeout(600);

const { cls, shifts } = await page.evaluate(() => ({
  // @ts-ignore
  cls: window.__cls,
  // @ts-ignore
  shifts: window.__shifts,
}));

console.log(`CLS after ${VOTE_CLICKS} votes: ${cls.toFixed(5)} (threshold ${CLS_THRESHOLD})`);
if (shifts.length) {
  console.log(`Shift entries (${shifts.length}):`);
  for (const s of shifts) console.log(`  +${s.value.toFixed(5)} @ ${s.time.toFixed(0)}ms`);
}

await browser.close();

if (cls > CLS_THRESHOLD) {
  fail(`Voting caused layout shift ${cls.toFixed(5)} > ${CLS_THRESHOLD}`);
}
pass(`Voting kept CLS at ${cls.toFixed(5)} (\u2264 ${CLS_THRESHOLD}).`);