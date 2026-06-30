# Simulated voter activity for the ticker

## Goal

Make the ticker feel alive even when real humans aren't voting. Popular terms
get a steady medium stream of fake activity, niche terms get a small trickle,
and the direction follows each term's recent real momentum so a term that's
"losing popularity" actually drifts down.

## Design rules

- **No pollution of real data.** Synthetic activity lives in its own table.
  Real `votes`, leaderboards, OAT counts, learned-trends, and streaks are
  untouched. The synthetic stream is purely cosmetic for the ticker price.
- **Server-driven**, not client-driven. A `pg_cron` job runs every minute so
  the ticker moves for every viewer consistently, not just whoever has a tab
  open.
- **Bias from real signal.** Direction = sign of recent real net votes
  (last ~24h, weighted toward last hour). Magnitude = base rate × popularity
  tier × random jitter.
- **Bounded.** Per-tick deltas are clamped so one tick can never flip a term
  from #1 to #last. Synthetic cumulative score per term decays slightly each
  tick so it can't run away over weeks.

## What changes

### 1. New table `public.synthetic_pulses`

Stores a rolling per-trend synthetic score that the ticker reads.

```text
trend_id        uuid pk → trends.id
synth_score     numeric  -- current cumulative synthetic delta
last_tick_at    timestamptz
updated_at      timestamptz
```

RLS: read = `anon` + `authenticated`, write = service role only.

### 2. New SQL function `public.tick_synthetic_pulses()` (SECURITY DEFINER)

Runs once per minute. For each trend:

1. Compute **popularity tier** from recent real net votes + peak intensity:
   - top 20% → "hot" (medium volume): ±3..6 units per tick
   - middle 50% → "warm": ±1..3
   - bottom 30% → "cold" (small trickle): ±0..1, often zero
2. Compute **bias** = sign of weighted recent real net votes
   (last 1h × 3 + last 24h × 1). Range −1..+1.
3. Per-tick delta = `tier_magnitude × (0.55 + 0.45 × bias) × jitter(-1..+1)`
   then clamp to ±8.
4. Apply small mean-reversion: `synth_score *= 0.985` before adding delta.
5. Upsert into `synthetic_pulses`.

### 3. Update `public.get_trend_scores()`

Add `synth_score` from `synthetic_pulses` into the existing price formula
so the ticker reflects it:

```text
price = base_price + 1.5 * real_net_votes + 1.0 * synth_score
```

`net_votes` returned to clients stays the **real** number (so leaderboards,
"live" badges, and detail pages still show truth). Only `price` includes the
synthetic component. This keeps charts, OAT standings, and voting UI honest.

### 4. `pg_cron` schedule (every minute)

```text
SELECT cron.schedule(
  'tick-synthetic-pulses',
  '* * * * *',
  $$ SELECT public.tick_synthetic_pulses(); $$
);
```

Pure SQL — no external HTTP, no edge function, no secrets.

### 5. Optional: emit a `vote_events` row per tick for trends with non-zero
delta so the existing realtime ticker subscription refetches scores
without us touching client code. (TickerBar already invalidates on
`vote_events` inserts.)

## What does NOT change

- `src/components/TickerBar.tsx`, `VoteButtons.tsx`, `LivePriceBar.tsx`,
  `PriceChart.tsx` — no client edits. They already read `get_trend_scores`.
- Real `votes` table — no synthetic inserts.
- Streaks, learned trends, leaderboards, OAT — all read from real votes only.

## Tuning knobs (constants inside `tick_synthetic_pulses`)

- Tick interval: 60s (cron)
- Hot/warm/cold thresholds: percentile based, recomputed each tick
- Per-tick clamp: ±8 units
- Decay factor: 0.985 (≈ half-life of ~45 minutes if no new pulses)
- Cold-tier zero-tick probability: ~60%

These can be adjusted in a follow-up without schema changes.

## Verification

- Watch `/` for ~2 minutes: hot terms tick frequently, cold terms barely move.
- Confirm in the database that real `votes` rows are unchanged and
  `synthetic_pulses` rows update each minute.
- Confirm a term with negative real momentum drifts down over ~10 minutes.
- Confirm OAT leaderboard and per-term net-vote counts still match real votes.

## Rollback

`SELECT cron.unschedule('tick-synthetic-pulses');` plus revert
`get_trend_scores` to drop the `synth_score` term. Table can be left in
place or dropped.