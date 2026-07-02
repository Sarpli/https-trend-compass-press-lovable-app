# Trenslate — full rebuild prompt

Paste everything between the `===` fences into Claude to rebuild Trenslate 1:1.

===

You are rebuilding a web app called **Trenslate** from scratch. Match the spec exactly. Stack: **TanStack Start v1** (Vite 7, React 19, file-based routing under `src/routes/`, server functions via `createServerFn` from `@tanstack/react-start`), **Tailwind CSS v4** (tokens in `src/styles.css`), **Supabase** (Auth + Postgres + RLS + Realtime + Storage bucket `trend-images`), **Lovable AI Gateway** (Gemini 2.0 Flash for semantic search), **TanStack Query** (loader `ensureQueryData` + `useSuspenseQuery`), **shadcn/ui** primitives, **sonner** toasts, **lucide-react** icons. Deploy target: Cloudflare Workers (nodejs_compat).

## 1. Product

Trenslate is a **cultural fluency newspaper** for internet slang, formatted like the Wall Street Journal. Terms are traded like stocks — each has a live price, a candlestick-free price-history chart, and up/down votes. Free readers get limited daily searches and only week/month voting. Pro readers get unlimited searches, year + all-time voting (with 2× weight for pro_annual), a saved glossary, After Hours dark mode, and archive access.

## 2. Design system

WSJ-style newsprint meets iOS 26 Liquid Glass.

- Fonts (self-hosted via `@fontsource`):
  - `display`: **Playfair Display** (headlines, term names)
  - `ui` / `small-caps`: **Söhne** if licensed, otherwise **Inter** with `font-feature-settings: "smcp"`
  - Body: **Source Serif Pro**
- Palette (light):
  - `--newsprint: #f7f3ea`, `--ink: #1a1a1a`, `--card: #ffffff`
  - `--accent-red: #b22222` (masthead stripe, section eyebrows)
  - `--ticker-up: #0f7a3d`, `--ticker-down: #b22222`
  - Muted foreground: `#4a4a4a`
- Palette (After Hours dark, Pro-only):
  - `--newsprint: #0e1116`, `--ink: #f2ede1`, `--card: #161a20`
  - Same accent-red, ticker-up shifted to `#3fbf72` for contrast
- Utilities: `.glass` (blur + saturate + inset highlight), `.glass-sheen` (moving highlight), `.rule-double`, `.rule-top`, `.rule-bottom`, `.display`, `.ui`, `.small-caps`, `.newsprint-grain` (SVG noise overlay at 4% opacity).
- Every color must be a semantic token. No hardcoded `text-white`, `bg-black`, or `bg-[#…]`.

## 3. Data model (Supabase, `public` schema)

Every table: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` + touch trigger. Every `CREATE TABLE` gets `GRANT` **in the same migration** (RLS alone is not enough). Roles live in a separate `user_roles` table with a `has_role(uuid, app_role)` SECURITY DEFINER function — never on `profiles`.

Tables:

- `profiles` — `id uuid` (FK auth.users), `display_name`, `is_founding_voter bool`, `push_enabled bool`, `streak_count int`, `max_streak int`, `last_active_date date`, `last_active_local_date date`. Trigger `profiles_block_privileged_updates` strips privileged columns from non-admin client writes.
- `subscriptions` — `user_id`, `tier` enum(`free`,`pro_monthly`,`pro_annual`), `status`, `current_period_end`.
- `user_roles` — `user_id`, `role` enum(`admin`,`user`).
- `trends` — `slug`, `term`, `category`, `plain_language`, `origin`, `safety_tips`, `examples jsonb`, `base_price numeric`, `origin_year int`, `image_path text`, `is_spotlight_eligible bool`.
- `votes` — `user_id`, `trend_id`, `category` enum(`week`,`month`,`year`,`oat`), `direction` enum(`up`,`down`), `weight int` (1 free/pro, 2 pro_annual), `period_key text`. Unique on `(user_id, trend_id, category, period_key)`. `REPLICA IDENTITY FULL`. Immutability trigger blocks mutating `user_id/trend_id/category/period_key/weight`.
- `vote_events` — realtime channel (INSERT-only, `trend_id`); populated by `broadcast_vote_event` trigger on `votes` and by `tick_synthetic_pulses`.
- `synthetic_pulses`, `synthetic_pulse_history` — background "market maker" so tickers move between real votes.
- `trend_popularity` — `trend_id`, `year int`, `month int`, `intensity int` (0–100). Seeded per term. Drives the price-history curve shape.
- `spotlight_pins` — admin override for daily spotlight `(local_date, trend_id)`.
- `learned_trends` — `user_id`, `trend_id`.
- `streak_history` — `user_id`, `action_date`, `new_streak_count`, `source` ('search'|'learned').
- `saved_glossary` — Pro-only, `user_id`, `trend_id`.
- `searches` — logs free-tier searches; trigger `bump_streak_on_search`.
- `dismissed_banners` — `user_id`, `banner_key`.
- `pro_upgrade_intents`, `pro_upgrade_intent_alerts` — captured when a free user tries a Pro action.
- `chunk_errors`, `chunk_error_reports` — client-side chunk-load failures.
- `perf_events`, `perf_alerts` — client + server perf sampling.

## 4. RLS + gating rules

- All tables RLS ON. Every user-owned table scopes to `auth.uid()`.
- `trends`, `trend_popularity`, `vote_events`, `synthetic_pulse_history` → public SELECT (anon).
- `votes`: public SELECT restricted to aggregate columns is not possible in RLS, so expose aggregates only via SECURITY DEFINER RPCs (`get_trend_scores`, `get_vote_tallies`, `get_category_vote_history`, `get_trend_price_history`). Client cannot select `votes` directly beyond own rows.
- `is_pro(uuid)`, `is_pro_self()`, `is_annual(uuid)`, `has_role(uuid, app_role)` — SECURITY DEFINER, `search_path=public`.
- Vote trigger `enforce_pro_for_premium_votes`: BEFORE INSERT on `votes` — if `category in ('year','oat')` and NOT `is_pro_self()`, log a `pro_upgrade_intents` row and RAISE `PRO_REQUIRED`. Also enforce `weight in (1,2)`.
- Free-tier search limit: 5 semantic searches/day (server-side count against `searches` inside the AI search server fn). Show remaining count on `/account`.
- Pro-only routes/features: `/archive`, After Hours dark mode toggle, saved glossary, year+oat voting boards.

## 5. Server logic

- `createServerFn` for all app-internal reads/writes. `requireSupabaseAuth` middleware for authenticated fns. Bearer attached via `attachSupabaseAuth` registered in `src/start.ts`.
- Public loaders must not call auth-gated fns (they run at SSR/prerender without a bearer).
- AI search: server fn `aiSearch` using Lovable AI Gateway (`google/gemini-2.0-flash`) with exponential backoff (3 retries, 200/600/1500ms), Zod input validation, and per-user daily quota enforcement for free tier.
- Admin image upload: server fn that writes to Supabase Storage `trend-images` bucket (private) and stores signed-URL-generation logic on read.
- Server routes only for external callers under `src/routes/api/public/*`:
  - `perf-regression-check` — pg_cron hits it hourly to run `check_perf_regressions()`.
- `client.server.ts` (service-role) is import-only inside `.server.ts` files, or loaded via `await import(...)` inside a handler. Never at module scope in `.functions.ts`.

## 6. Routes (`src/routes/`)

`__root.tsx` — masthead + ticker + footer + `<Outlet />`. `head()` sets Trenslate title, description, og tags. Wire `supabase.auth.onAuthStateChange` filtered to `SIGNED_IN`/`SIGNED_OUT`/`USER_UPDATED`; invalidate router + query cache accordingly.

Public routes: `index.tsx` (front page), `trends.$slug.tsx`, `vote.tsx`, `pricing.tsx`, `auth.tsx`, `glossary.tsx`, `settings.tsx`, `recommended.tsx`.

Authenticated routes under `src/routes/_authenticated/` (integration-managed `ssr:false` gate): `account.tsx`, `archive.tsx` (Pro-only inside), `admin.trends.tsx` (admin role check inside).

Every route with a loader defines `errorComponent` (with a "Try again" button that calls both `reset()` and `router.invalidate()`) and `notFoundComponent`. Root sets `defaultErrorComponent` and `defaultNotFoundComponent`.

## 7. Front page (`/`)

Deterministic per **local calendar date** (uses `use-local-date.ts` — handles DST spring-forward, fall-back repeated hour, and Kiritimati UTC+14 edge cases). Layout:

1. Red masthead stripe: "TRENSLATE" wordmark, tagline "The paper of record for internet culture", Vol. I No. N metadata, weekday + local date.
2. **TickerBar** (sticky, above content): horizontal marquee of all trends with symbol, price, day % (green/red). Supports hover-pause, touch scrubbing, keyboard focus. Popularity-weighted speed. Subscribes to `vote_events` realtime channel.
3. **Trend Spotlight** — full-width cover image (via `TrendCover`, uses AVIF/WebP/JPG responsive set + object-cover with dilute gradient, never crop). Selected by `spotlight_pins` override or deterministic hash of `local_date + eligible trend ids`. Smaller on mobile.
4. **The Daily Briefing** — 6 story cards (2×3 on desktop, 1-col mobile), each links to `/trends/$slug`. Shows a small "🎓 Learned" flag if user has learned it.
5. Sidebar (desktop): "Top movers", "Founding voters", CTA to /pricing.
6. Footer with links to `/pricing`, `/glossary`, `/settings`, `/auth`.

## 8. Trend detail (`/trends/$slug`)

- Back button (uses history.back with scroll restoration).
- Category eyebrow, big display term, `TrendCover` (16/9, eager, `fetchpriority=high`).
- Plain-language summary.
- Rule-double stats bar: ticker price, net votes, Save-to-glossary button (Pro).
- `LivePriceBar` (glass card): live dot pulse, current price, day delta derived from **the same price-history series** the chart renders (never a divergent source), 24-point sparkline, since-launch %.
- `PriceChart`: SVG line chart from `get_trend_price_history` RPC. Colored by last segment direction. Gridlines, base-price dashed reference, hover tooltip with month-year. Realtime refetch on `vote_events` for this trend, deferred if a local vote is mid-flight (`vote-reconcile.ts`).
- Three sections: Origin & context, Safety & nuance (with `ShieldAlert`), In the wild (blockquoted examples).
- Aside: "Cast your vote" — VoteButtons for all four categories; year/oat show 🔒 for free users with CTA to `/pricing`.
- Bottom: `LearnedBanner` — dismissible 🔥 banner; if trend already learned but no check-in today, shows "Use for today's streak" button that calls `mark_trend_learned(_trend_id, _local_date)` RPC.

## 9. Voting

`VoteButtons` component: oversized chevrons (`ChevronUp`/`ChevronDown` 28px), tabular-nums net count, no layout shift (fixed width). Optimistic updates via TanStack Query mutation. Haptics via `src/lib/haptics.ts` (`navigator.vibrate` + optional audio "tock" respecting `SettingsProvider.hapticsEnabled`). CLS regression test in `tests/cls_vote.py`.

`/vote` — leaderboards for all four categories, top 10 per category. year+oat locked with 🔒 badge for free users.

## 10. Search + archive

- Home + `/glossary` + `/archive` all use the same AI search modal. Semantic search hits `aiSearch` server fn.
- Free tier: max 5 queries/day, remaining count surfaced on `/account`.
- `/archive` gated by `is_pro_self()`; unauth free users see "Pro required" state.

## 11. Ticker RPCs

- `get_trend_scores()` — `(trend_id, slug, term, price, net_votes)` combining `base_price + 1.5*net + 1.0*synth_score`.
- `get_trend_price_history(_trend_id)` — deterministic monthly geometric-Brownian walk anchored to `trend_popularity`. Direction skewed by age + popularity (new+popular = bullish, old+niche = bearish). Per-month volatility scales with that term's own intensity that month; per-month direction bias follows the local slope of its popularity anchors. Recent votes tilt drift. Appends synthetic-pulse tail for the last 7 days.
- `get_vote_tallies(_category, _period_key)`, `get_category_vote_history(_category, _period_key)`, `get_effective_streak(_local_date)`, `mark_trend_learned(_trend_id,_local_date)`, `tick_synthetic_pulses()` (pg_cron every minute), `prune_synthetic_pulse_history()` (daily), `check_perf_regressions()` (hourly), `detect_pro_upgrade_intent_anomalies()` (hourly), `prune_pro_upgrade_intents()` (daily), `prune_perf_events()` (daily).

## 12. Auth

Email/password + Google + Apple. Google/Apple go through the Lovable broker (`lovable.auth.signInWithOAuth`), redirect_uri = `window.location.origin`. `WelcomeAuthModal` is a mobile-first bottom sheet. `handle_new_user()` trigger inserts profile + subscription(`free`) + user_role(`user`). Never allow anonymous sign-ups. Never auto-confirm emails.

## 13. Account + settings

- `/account` (auth-gated): tier + upgrade CTA, streak count, learned-terms count, saved glossary size (Pro), searches remaining today (free), `ChangePassword`, sign out.
- `/settings`: After Hours dark mode toggle (Pro-gated with lock), ticker speed slider, streak-animation toggle, haptics toggle, push notifications toggle.

## 14. Streaks

- Daily streak = one search OR one "Use for streak" tap per local date.
- `get_effective_streak(_local_date)` returns 0 if last activity older than yesterday. All streak math anchored to the viewer's local calendar date (never UTC).
- `StreakBadge` in header; `StreakCelebration` (confetti burst) fires on new-day milestones (7, 30, 100).

## 15. Realtime, perf, error handling

- Subscribe to `vote_events` at the ticker level once, plus per-trend on `PriceChart`. Debounce refetches; defer to optimistic mutations in flight.
- `perf.ts` samples ticker RPC duration, long tasks, FCP → `perf_events`. Hourly cron computes p95 regressions.
- `chunk-retry.ts` logs Vite chunk errors to `chunk_errors` with dedup trigger, shows a sonner toast with retry + "Report this issue" that writes `chunk_error_reports`.
- `RouteSkeleton` (WSJ-style) for pending routes.

## 16. Admin

- `/admin/trends` (admin role only): CRUD trend metadata, upload cover to `trend-images`, edit popularity anchors, pin daily spotlight.
- Never expose service-role key. Admin writes go through `createServerFn` + `requireSupabaseAuth` + role check.

## 17. Security invariants (do not violate)

1. Roles ONLY in `user_roles`. Never on `profiles`. All role checks via `has_role`.
2. `profiles_block_privileged_updates` trigger strips `is_founding_voter`, `push_enabled`, streak columns, and `id` on non-admin UPDATE.
3. `enforce_pro_for_premium_votes` trigger + `is_pro_self()` gate year/oat votes server-side. Client-side lock is UI only.
4. `votes_block_field_mutation` prevents changing user/trend/category/period_key/weight on UPDATE.
5. Every new public table in every migration ends with the four-step block: CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY. `service_role` always granted. `anon` only where public-read policy exists.
6. AI search server fn validates input with Zod, enforces free-tier daily quota server-side, uses backoff.
7. `SUPABASE_SERVICE_ROLE_KEY` and `LOVABLE_API_KEY` are server-only. `process.env.*` only inside handler bodies of `.server.ts` files, never at module scope of client-imported modules.

## 18. Testing

Playwright end-to-end scripts under `tests/` mirroring the current suite: `cls_vote.py`, `timezone_dst_flip.py`, `sleep_resume_flip.py`, `daily_stories_shuffle.py`, `security_regressions.py` (verifies profile privilege escalation + non-Pro year/oat rejection), `pro_gating.py`, `pro_upgrade_flow.py`, `free_search_limit.py`, `leaderboard_net_updates.py`, `ticker_stress.py`, `back_scroll_restore.py`, `streak_persistence.py`. Provide a GitHub Actions workflow `cls-regression.yml`.

## 19. Head metadata

Set a real title + description in `__root.tsx` and unique metadata on every leaf route. `og:image` only on leaf routes with a meaningful hero — derive from loader data on trend detail. Never use the placeholders "Lovable App" / "Lovable Generated Project".

## 20. Seed data

Seed ~60 trends across categories (slang, aesthetic, meme, subculture, phrase). For each: term, slug, plain_language (1 sentence), origin (2–4 sentences, no "Know Your Meme" references), safety_tips, 3 example sentences, base_price 60–260, origin_year, and 8–24 `trend_popularity` anchors describing that term's real trajectory over time. Include: Slay, Rizzler, Delulu, Skibidi, Low Taper Fade, Chopped Chin, Ragebait, Strawberry Elephant, Irish Exit, Pattern Recognition, Du Bist Gut Genug, Unc, Mog, Goyslop, "I wish I had a free bag of chips". Do NOT include Haskell.

---

Build all of the above in one pass. When a decision isn't specified, follow the WSJ + iOS Liquid Glass aesthetic and prefer server-side enforcement over client-side. Ship migrations, seed data, tests, and README together.