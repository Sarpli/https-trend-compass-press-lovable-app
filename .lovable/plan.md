# Trendslated — 1-Page Build Spec

## Product
WSJ-style "cultural fluency newspaper" for internet slang. Terms trade like stocks: live prices, price-history charts, up/down votes. Free tier = limited; Pro = unlimited + extras.

## Stack
TanStack Start v1 (Vite 7, React 19, file-routing `src/routes/`, `createServerFn`) · Tailwind v4 (tokens in `src/styles.css`) · Supabase (Auth + Postgres + RLS + Realtime + Storage `trend-images`) · Lovable AI Gateway (`google/gemini-2.0-flash`) · TanStack Query (loader `ensureQueryData` + `useSuspenseQuery`) · shadcn/ui · sonner · lucide-react · Cloudflare Workers (nodejs_compat).

## Design
WSJ newsprint + iOS Liquid Glass. Fonts: Playfair Display (headlines), Inter/Söhne small-caps (UI), Source Serif Pro (body). Tokens only — no hardcoded colors. Light: `--newsprint:#f7f3ea`, `--ink:#1a1a1a`, `--accent-red:#b22222`, `--ticker-up:#0f7a3d`, `--ticker-down:#b22222`. Pro-only After Hours dark palette. Utilities: `.glass`, `.rule-double`, `.small-caps`, `.newsprint-grain`.

## Data (Supabase public schema; every CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY in same migration)
`profiles`, `subscriptions(tier: free|pro_monthly|pro_annual)`, `user_roles(role: admin|user)`, `trends`, `votes(category: week|month|year|oat, direction, weight, period_key)`, `vote_events`, `synthetic_pulses(+_history)`, `trend_popularity`, `spotlight_pins`, `learned_trends`, `streak_history`, `saved_glossary`, `searches`, `dismissed_banners`, `pro_upgrade_intents(+_alerts)`, `chunk_errors(+_reports)`, `perf_events(+_alerts)`.

## Security Invariants
1. Roles ONLY in `user_roles`; check via `has_role()` SECURITY DEFINER.
2. `profiles_block_privileged_updates_trg` strips privileged cols from non-admin writes.
3. `enforce_pro_for_premium_votes` — year/oat votes require `is_pro_self()`; log intent + raise `PRO_REQUIRED`.
4. `votes.weight` server-enforced: 2 only if `is_annual_self()`, else 1.
5. `votes_block_field_mutation` prevents changing user/trend/category/period_key/weight.
6. `perf_events`/`chunk_errors` INSERT policies require `user_id = auth.uid()` or NULL.
7. `/api/public/hooks/perf-regression-check` requires `PERF_CRON_SECRET` bearer.
8. AI search: Zod-validated, exp-backoff (200/600/1500ms), free-tier 5/day server-enforced.
9. Service-role client (`client.server.ts`) never at module scope in client-imported files.
10. Vote aggregates exposed ONLY via SECURITY DEFINER RPCs (`get_trend_scores`, `get_vote_tallies`, `get_category_vote_history`, `get_trend_price_history`).

## Routes
Public: `/`, `/trends/$slug`, `/vote`, `/pricing`, `/auth`, `/glossary`, `/settings`, `/recommended`. Authed (`_authenticated/`): `/account`, `/archive` (Pro), `/admin/trends` (admin). Every loader route needs `errorComponent` + `notFoundComponent`.

## Front Page
Deterministic per **local calendar date** (DST-safe via `use-local-date.ts`). Layout: red masthead → sticky **TickerBar** (marquee, realtime `vote_events`, hover-pause) → **Spotlight** (`spotlight_pins` override or deterministic hash) → **Daily Briefing** 6 cards → sidebar (top movers, founding voters, /pricing CTA) → footer.

## Trend Detail
`TrendCover` 16/9 responsive AVIF/WebP/JPG → glass `LivePriceBar` (24pt sparkline) → `PriceChart` from `get_trend_price_history` (GBM anchored to `trend_popularity`, synthetic-pulse tail) → Origin / Safety / In the wild → `VoteButtons` (4 categories, year/oat 🔒 for free) → `LearnedBanner` (`mark_trend_learned` RPC).

## Features
- **Voting:** optimistic mutations, no CLS (fixed-width tabular-nums), haptics via `navigator.vibrate`. `/vote` = top 10 per category.
- **Search:** semantic AI modal on `/`, `/glossary`, `/archive`. Free 5/day.
- **Streaks:** search OR "use for streak" per local date; `get_effective_streak(_local_date)` RPC; confetti at 7/30/100.
- **Auth:** email/password + Google + Apple via `lovable.auth.signInWithOAuth`. `handle_new_user()` trigger seeds profile+sub(free)+role(user). No anon sign-ups, no auto-confirm.
- **Payments:** Stripe DISCONNECTED — `/pricing` shows plans; tier flipped manually in `subscriptions`.
- **Admin:** `/admin/trends` CRUD + cover upload + popularity anchors + pin spotlight.
- **Realtime/Perf:** `vote_events` channel; `perf.ts` samples → `perf_events`; hourly cron `check_perf_regressions()`; `chunk-retry.ts` logs + toast retry.

## Head Metadata
Real title/description in `__root.tsx`; unique per leaf route. `og:image` only on leaves with a hero (derive from loader data on trend detail). Never "Lovable App"/"Lovable Generated Project".

## Seed
~60 trends across slang/aesthetic/meme/subculture/phrase with term, slug, plain_language, origin (no KYM refs), safety_tips, 3 examples, base_price 60–260, origin_year, 8–24 `trend_popularity` anchors. Include: Slay, Rizzler, Delulu, Skibidi, Low Taper Fade, Chopped Chin, Ragebait, Strawberry Elephant, Irish Exit, Pattern Recognition, Du Bist Gut Genug, Unc, Mog, Goyslop, "I wish I had a free bag of chips". Exclude Haskell.

## Tests (Playwright, `tests/`)
`cls_vote`, `timezone_dst_flip`, `sleep_resume_flip`, `daily_stories_shuffle`, `security_regressions`, `pro_gating`, `pro_upgrade_flow`, `free_search_limit`, `leaderboard_net_updates`, `ticker_stress`, `back_scroll_restore`, `streak_persistence`. GH Action `cls-regression.yml`.
