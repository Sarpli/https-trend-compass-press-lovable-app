# Trendslated — full rebuild prompt

Paste everything below into another AI app generator to build a 1:1 replica of Trendslated.

---

You are building a web app called **Trendslated**. It is a **cultural fluency newspaper** for internet slang, styled like the Wall Street Journal, where each slang term is traded like a stock: it has a live price, a price-history chart, and up/down votes. Free readers get limited daily searches and only week/month voting. Pro readers get unlimited search, year + all-time voting (2× vote weight on `pro_annual`), a saved glossary, After Hours dark mode, and archive access.

## 1. Tech stack (non-negotiable)

- **TanStack Start v1** (Vite 7, React 19). File-based routing under `src/routes/`. Server logic via `createServerFn` from `@tanstack/react-start`. External-caller HTTP endpoints live under `src/routes/api/public/*`.
- **Tailwind CSS v4** with tokens declared in `src/styles.css` (`@theme`). No hardcoded colors in components — everything is a semantic token.
- **shadcn/ui** primitives, **lucide-react** icons, **sonner** toasts.
- **Supabase** (Auth + Postgres + RLS + Realtime + private Storage bucket `trend-images`). Every `CREATE TABLE public.*` MUST be followed by GRANT statements in the same migration.
- **TanStack Query** with the canonical loader shape: `context.queryClient.ensureQueryData(queryOptions)` in the loader + `useSuspenseQuery(queryOptions)` in the component.
- **Lovable AI Gateway** — `google/gemini-2.0-flash` for semantic search (exponential backoff 200/600/1500ms, Zod-validated input, server-side per-user daily quota for free tier).
- **Auth providers:** email/password, Google, Apple. Google and Apple MUST go through the Lovable broker: `lovable.auth.signInWithOAuth("google" | "apple", { redirect_uri: window.location.origin })`. Never call raw `supabase.auth.signInWithOAuth` for Google/Apple.
- Deploy target is Cloudflare Workers with `nodejs_compat`. Read `process.env.*` only inside server-fn handler bodies, never at module scope of client-imported files.
- **Payments are NOT wired up** in v1. Leave the "Subscribe" buttons as stubs that navigate signed-out users to `/auth` and otherwise no-op with a comment `// Paid subscriptions are temporarily unavailable.`. Manage tier assignment directly through the `subscriptions` table for now.

## 2. Design system

WSJ newsprint meets iOS 26 Liquid Glass.

- Fonts (self-hosted via `@fontsource`):
  - `display`: **Playfair Display** — headlines, term names, big numbers.
  - `ui` / `small-caps`: **Inter** with `font-feature-settings: "smcp"`.
  - Body: **Source Serif Pro**.
- Palette — light (default):
  - `--newsprint: #f7f3ea`, `--ink: #1a1a1a`, `--card: #ffffff`
  - `--accent-red: #b22222` (masthead stripe + section eyebrows)
  - `--ticker-up: #0f7a3d`, `--ticker-down: #b22222`
  - Muted foreground `#4a4a4a`.
- Palette — After Hours dark (Pro only):
  - `--newsprint: #0e1116`, `--ink: #f2ede1`, `--card: #161a20`
  - Same accent-red. `--ticker-up: #3fbf72` for dark-mode contrast.
- Utilities in `src/styles.css`:
  - `.glass` (backdrop blur + saturate + inset highlight), `.glass-sheen` (moving highlight).
  - `.rule-top`, `.rule-bottom`, `.rule-double` (WSJ hairlines).
  - `.display`, `.ui`, `.small-caps` typography helpers.
  - `.newsprint-grain` — SVG noise overlay at 4% opacity.
- Every color, gradient, and shadow is a semantic token. No `text-white`, `bg-black`, or `bg-[#...]` in components.

## 3. Data model (Supabase, `public` schema)

Every table has `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, and (where mutable) `updated_at timestamptz default now()` with a shared `update_updated_at_column()` BEFORE UPDATE trigger. Every `CREATE TABLE` in `public` is immediately followed by:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
GRANT ALL ON public.<table> TO service_role;
-- add GRANT SELECT TO anon ONLY when a policy actually allows anon reads
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY ...
```

Tables:

- `profiles` — `id uuid` (FK `auth.users`), `display_name`, `is_founding_voter bool`, `push_enabled bool`, `streak_count int`, `max_streak int`, `last_active_date date`, `last_active_local_date date`.
- `subscriptions` — `user_id`, `tier` enum `free | pro_monthly | pro_annual`, `status`, `current_period_end`. `handle_new_user()` inserts `tier='free'`.
- `user_roles` — `user_id`, `role` enum `admin | user`. **Roles live ONLY here — never on `profiles`.**
- `trends` — `slug`, `term`, `category`, `plain_language`, `origin`, `safety_tips`, `examples jsonb`, `base_price numeric`, `origin_year int`, `image_path text`, `is_spotlight_eligible bool`.
- `votes` — `user_id`, `trend_id`, `category` enum `week | month | year | oat`, `direction` enum `up | down`, `weight int`, `period_key text`. `UNIQUE (user_id, trend_id, category, period_key)`. `REPLICA IDENTITY FULL`.
- `vote_events` — realtime broadcast channel (INSERT-only), populated by `broadcast_vote_event` AFTER INSERT trigger on `votes` and by `tick_synthetic_pulses`.
- `synthetic_pulses` / `synthetic_pulse_history` — background "market maker" so ticker prices drift between real votes.
- `trend_popularity` — `trend_id`, `year int`, `month int`, `intensity int` (0–100). Seeded per term; drives price-history curve shape.
- `spotlight_pins` — admin override for the daily front-page spotlight `(local_date, trend_id)`.
- `learned_trends` — `user_id`, `trend_id`.
- `streak_history` — `user_id`, `action_date`, `new_streak_count`, `source` (`'search' | 'learned'`).
- `saved_glossary` — Pro-only. `user_id`, `trend_id`.
- `searches` — logs free-tier searches. Trigger `bump_streak_on_search` advances the streak.
- `dismissed_banners` — `user_id`, `banner_key`.
- `pro_upgrade_intents` / `pro_upgrade_intent_alerts` — captured when a free user attempts a Pro-only action.
- `chunk_errors` / `chunk_error_reports` — client chunk-load failures.
- `perf_events` / `perf_alerts` — client + server perf sampling.

## 4. Security invariants (must all be true)

1. **`has_role(_user_id uuid, _role app_role)`** — SECURITY DEFINER, `search_path=public`, `STABLE`. Sole way to check roles. All admin RLS policies use it.
2. **`is_pro_self()` / `is_annual_self()`** — SECURITY DEFINER `search_path=public`. Read the caller's row in `subscriptions` and return true only when tier matches and `status='active'` and (`current_period_end IS NULL OR current_period_end > now()`).
3. **`profiles_block_privileged_updates_trg`** — BEFORE UPDATE on `profiles`. If the caller is not admin, force `NEW.is_founding_voter = OLD.is_founding_voter`, `NEW.push_enabled = OLD.push_enabled`, `NEW.streak_count = OLD.streak_count`, `NEW.max_streak = OLD.max_streak`, `NEW.last_active_date = OLD.last_active_date`, `NEW.last_active_local_date = OLD.last_active_local_date`, `NEW.id = OLD.id`. Applies to ALL non-admin sessions including `authenticated`.
4. **`enforce_pro_for_premium_votes`** — BEFORE INSERT on `votes`. If `NEW.category IN ('year','oat')` AND NOT `is_pro_self()`: insert a `pro_upgrade_intents` row (fire-and-forget) and `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRO_REQUIRED'`. Also enforce `NEW.weight IN (1,2)` and that `weight = 2` only when `is_annual_self()`; otherwise force `weight = 1`.
5. **`votes_block_field_mutation`** — BEFORE UPDATE on `votes`. Rejects any change to `user_id`, `trend_id`, `category`, `period_key`, `weight`. Only `direction` is mutable.
6. **`perf_events` INSERT policy** — allow only when `user_id IS NULL OR user_id = auth.uid()` AND `duration_ms BETWEEN 0 AND 60000` AND `char_length(route) <= 200` AND `char_length(metric) <= 100`. No public DELETE/UPDATE policy — only service_role can prune (via cron RPCs).
7. **`chunk_errors` / `chunk_error_reports` INSERT policies** — allow only when `user_id = auth.uid()` (authenticated) OR `user_id IS NULL` (anon). SELECT restricted to owner (`auth.uid() = user_id`).
8. **Aggregate vote reads are RPC-only** — clients cannot `select * from votes` beyond their own rows. Aggregates come from SECURITY DEFINER RPCs (`get_trend_scores`, `get_vote_tallies`, `get_category_vote_history`, `get_trend_price_history`) that are EXECUTE-granted to `anon` and `authenticated`.
9. **`/api/public/hooks/perf-regression-check`** — requires header `Authorization: Bearer ${PERF_CRON_SECRET}`; reject with 401 otherwise. `PERF_CRON_SECRET` is a server secret. pg_cron hits this hourly.
10. **AI search server fn** — Zod input validation, server-side quota enforcement (`5` semantic searches per calendar day for `free` tier, unlimited for pro), exponential backoff.
11. **`profiles`, `subscriptions`, `user_roles`, `saved_glossary`, `learned_trends`, `streak_history`, `searches`, `dismissed_banners`, `pro_upgrade_intents`, `chunk_errors`, `chunk_error_reports`, `perf_events`** — RLS scopes to `auth.uid()`. Public SELECT only on `trends`, `trend_popularity`, `vote_events`, `synthetic_pulse_history`.
12. **`SUPABASE_SERVICE_ROLE_KEY`** and **`LOVABLE_API_KEY`** are server-only. Only import `@/integrations/supabase/client.server` from `*.server.ts`, or lazily via `await import(...)` inside a handler body of a `.functions.ts` file. Never at module scope of client-reachable files.
13. **No anonymous sign-ups. No email auto-confirm** (unless explicitly requested).
14. **`handle_new_user()`** BEFORE INSERT trigger on `auth.users` inserts default rows in `profiles`, `subscriptions` (`tier='free'`), and `user_roles` (`role='user'`).

## 5. Server logic

- App-internal reads/writes → `createServerFn`. Authenticated ones use `.middleware([requireSupabaseAuth])` and read `context.supabase / context.userId`.
- External callers (cron, webhooks, public APIs) → server routes under `src/routes/api/public/*`. Verify signatures/secrets in the handler.
- `src/start.ts` registers `attachSupabaseAuth` as `functionMiddleware` so protected server fns receive the bearer token. Never replace the array — append.
- **Never** call a `requireSupabaseAuth` server fn from a public route's loader (SSR/prerender has no bearer → 401 → build fail). Call from the component via `useServerFn` + `useQuery` instead, or move the route under `_authenticated/`.

## 6. Routes (`src/routes/`)

Root: `__root.tsx` renders masthead + `TickerBar` + `<Outlet />` + `SiteFooter`, sets Trendslated `head()` (title, description, og:*), and wires a single `supabase.auth.onAuthStateChange` listener filtered to `SIGNED_IN | SIGNED_OUT | USER_UPDATED` that calls `router.invalidate()` and (unless `SIGNED_OUT`) `queryClient.invalidateQueries()`.

Public routes: `index.tsx`, `trends.$slug.tsx`, `vote.tsx`, `pricing.tsx`, `auth.tsx`, `glossary.tsx`, `settings.tsx`, `recommended.tsx`, `privacy.tsx`, `terms.tsx`.

Authenticated routes under `src/routes/_authenticated/` (integration-managed `ssr: false` gate — do NOT author the layout): `account.tsx`, `archive.tsx` (Pro-gated inside), `admin.trends.tsx` (admin role check inside).

Every route with a loader defines:
- `errorComponent` — "Try again" button calls both `reset()` AND `router.invalidate()`.
- `notFoundComponent` — WSJ-style empty state.

Root sets `defaultErrorComponent`, `defaultNotFoundComponent`, `defaultPendingComponent: RouteSkeleton`, `defaultPreloadStaleTime: 0`.

## 7. Front page (`/`)

Deterministic per **local calendar date** using `src/lib/use-local-date.ts` — handles DST spring-forward (skipped hour), DST fall-back (repeated hour), and Kiritimati (UTC+14) edge cases.

Layout, top to bottom:
1. **Red masthead stripe** — "TRENDSLATED" wordmark centered, tagline `The paper of record for internet culture`, `Vol. I No. N` metadata, weekday + local date.
2. **TickerBar** — sticky horizontal marquee of all trends. Each cell: symbol · price (tabular-nums) · day % change (green up, red down). Hover pauses; touch scrubs; keyboard-focusable. Speed weighted by popularity. Subscribes to `vote_events` realtime channel and refetches `get_trend_scores` on debounce.
3. **Trend Spotlight** — full-width cover image via `<TrendCover>` (AVIF/WebP/JPG responsive srcset, `object-cover`, dilute gradient overlay, never crops the term text). Selected by `spotlight_pins` override if present for today's local date, otherwise deterministic hash of `local_date + eligible trend ids`. Smaller on mobile.
4. **The Daily Briefing** — 6 story cards (2×3 desktop, 1-col mobile) linking to `/trends/$slug`. Each card shows a `LearnedFlag` (🎓) if the current user has learned it.
5. **Sidebar (desktop only)** — "Top movers", "Founding voters", CTA card linking to `/pricing`.
6. **Footer** — links to `/pricing`, `/glossary`, `/settings`, `/auth`, `/privacy`, `/terms`.

## 8. Trend detail (`/trends/$slug`)

- Back button that uses `history.back()` with scroll-restoration handled by `src/lib/scroll-memory.tsx`.
- Category eyebrow (small-caps accent-red), big display term, `TrendCover` (16/9, `loading="eager"`, `fetchPriority="high"`).
- Plain-language summary paragraph.
- **Rule-double stats bar** — ticker price, net votes, Save-to-glossary button (Pro-gated).
- **`<LivePriceBar>`** — glass card with a pulsing live dot, current price, day delta derived from **the exact same series `PriceChart` renders** (never a divergent source), 24-point sparkline, since-launch %.
- **`<PriceChart>`** — SVG line chart from `get_trend_price_history(_trend_id)`. Colored by direction of the last segment. Gridlines, dashed reference line at `base_price`, hover tooltip with month-year. Subscribes to `vote_events` filtered to this trend's `trend_id`; refetch is deferred when a local vote mutation is mid-flight (see `src/lib/vote-reconcile.ts`).
- Three sections: **Origin & context**, **Safety & nuance** (with `<ShieldAlert />` icon), **In the wild** (blockquoted example sentences).
- **Aside — "Cast your vote"** — `<VoteButtons>` for all four categories: `week`, `month`, `year`, `oat`. `year` and `oat` show a 🔒 for free users with CTA to `/pricing`.
- **`<LearnedBanner>`** at the bottom — dismissible 🔥 celebration; if the trend is already learned but no check-in today, show "Use for today's streak" which calls the `mark_trend_learned(_trend_id, _local_date)` RPC.
- `head()` sets a per-trend title, description, og:title/og:description/og:image (derived from loader data pointing at the trend cover).

## 9. Voting UX

`<VoteButtons>` — oversized `ChevronUp` / `ChevronDown` (28px), `tabular-nums` net-count between them, **zero layout shift** at all counts (fixed min-width bucket).

- Optimistic updates via TanStack Query mutation.
- Haptics via `src/lib/haptics.ts` — `navigator.vibrate` plus an optional audio "tock", both respecting `SettingsProvider.hapticsEnabled`.
- CLS regression test lives at `tests/cls_vote.py` — must stay green.

`/vote` — leaderboards for all four categories, top 10 per category. `year` and `oat` show 🔒 badges for free users with a lock-CTA to `/pricing`. Board updates via realtime `vote_events`.

## 10. Search + archive

- Home, `/glossary`, and `/archive` share one AI search modal.
- Semantic search hits the `aiSearch` server fn (Gemini 2.0 Flash).
- Free tier: max 5 semantic queries per local calendar day. Remaining count surfaced on `/account`.
- `/archive` — gated inside the component via `is_pro_self()`. Non-Pro users see a "Pro required" state, not a redirect.

## 11. Ticker + price RPCs

- `get_trend_scores()` → `(trend_id, slug, term, price, net_votes)` where `price = base_price + 1.5 * net_votes + 1.0 * synth_score`. Public.
- `get_trend_price_history(_trend_id)` → deterministic monthly geometric-Brownian walk anchored to that term's `trend_popularity` intensities. Direction skewed by (age, popularity): new+popular = bullish, old+niche = bearish. Per-month volatility scales with intensity that month; per-month drift bias follows the local slope of the popularity curve. Recent votes tilt drift near the tail. Appends synthetic-pulse tail for the last 7 days.
- `get_vote_tallies(_category, _period_key)`, `get_category_vote_history(_category, _period_key)`, `get_effective_streak(_local_date)`, `mark_trend_learned(_trend_id, _local_date)`.
- Background pg_cron jobs: `tick_synthetic_pulses()` every minute, `prune_synthetic_pulse_history()` daily, `check_perf_regressions()` hourly (through `/api/public/hooks/perf-regression-check` with `PERF_CRON_SECRET`), `detect_pro_upgrade_intent_anomalies()` hourly, `prune_pro_upgrade_intents()` daily, `prune_perf_events()` daily.

## 12. Auth

- Email/password + Google + Apple. Google/Apple via `lovable.auth.signInWithOAuth`, `redirect_uri = window.location.origin`. Do NOT redirect OAuth into a protected route.
- Configure the Google and Apple providers in Supabase Auth in the same turn as introducing the buttons (otherwise first sign-in errors "Unsupported provider").
- `<WelcomeAuthModal>` is a mobile-first bottom sheet.
- `handle_new_user()` trigger seeds `profiles`, `subscriptions(tier='free')`, `user_roles(role='user')`.
- No anonymous sign-ups. No email auto-confirm.

## 13. Account + settings

- `/account` (auth-gated):
  - Tier + Upgrade CTA (to `/pricing`) when free.
  - Current streak, max streak, streak flames.
  - Learned-terms count, saved-glossary size (Pro).
  - Searches remaining today (free tier).
  - `<ChangePassword>`, `<DeleteAccount>`, Sign out.
  - Admin users see an "Editor's desk" link to `/admin/trends`.
- `/settings`:
  - After Hours dark mode toggle (Pro-gated with 🔒 for free users).
  - Ticker speed slider.
  - Streak-animation toggle.
  - Haptics toggle.
  - Push notifications toggle (via `PushNotificationsToggle`).

## 14. Streaks

- One streak per user. Advances by either a search OR a "Use for streak" tap on a trend detail per local calendar date.
- `get_effective_streak(_local_date)` returns 0 if last activity is older than yesterday.
- All streak math is anchored to the viewer's **local** calendar date, never UTC.
- `<StreakBadge>` in the header; `<StreakCelebration>` fires a confetti burst on 7 / 30 / 100 day milestones.

## 15. Realtime, perf, error handling

- Subscribe to `vote_events` once at the ticker level, plus per-trend inside `PriceChart`. Debounce refetches. Defer to any optimistic mutation currently in flight.
- `src/lib/perf.ts` samples ticker RPC duration, long tasks, FCP → `perf_events`. Hourly cron computes p95 regressions.
- `src/lib/chunk-retry.ts` logs Vite chunk failures to `chunk_errors` (dedup trigger), shows a `sonner` toast with a Retry + "Report this issue" button that writes to `chunk_error_reports`.
- `<RouteSkeleton>` — WSJ-style pending fallback.

## 16. Admin

- `/admin/trends` — admin role only (check `has_role(auth.uid(), 'admin')` inside the component). CRUD trend metadata, upload cover to the `trend-images` bucket (private, read via signed URLs), edit `trend_popularity` anchors, pin daily spotlight.
- Admin writes go through `createServerFn` + `requireSupabaseAuth` + explicit `has_role` check. Never expose the service-role key.

## 17. Head metadata

- `__root.tsx` sets a real Trendslated title + description + og:title/og:description/og:type/twitter:card. Never the placeholders "Lovable App" or "Lovable Generated Project".
- Every leaf route sets its own unique title + description. `og:image` ONLY on leaf routes with a meaningful hero — derive from loader data on `trends.$slug.tsx`. Never put `og:image` on `__root.tsx`.
- Single `<h1>` per route. Semantic HTML. Responsive viewport (Vite default). Lazy-load below-the-fold images. Add JSON-LD to trend detail if practical.

## 18. Testing

Playwright end-to-end scripts under `tests/`:

- `cls_vote.py` — no layout shift when vote counts change.
- `timezone_dst_flip.py`, `sleep_resume_flip.py` — local-date correctness across DST + PWA resume.
- `daily_stories_shuffle.py` — front-page determinism per local date.
- `security_regressions.py` — profiles privilege-escalation attempts fail; non-Pro `year`/`oat` votes rejected server-side; `perf_events` cross-user spoof rejected; `chunk_errors` cross-user spoof rejected.
- `pro_gating.py`, `pro_upgrade_flow.py`, `pro_upgrade_inplace.py`, `pro_downgrade_flow.py`, `pro_voting.py`, `pro_year_oat_voting.py`, `annual_oat_voting.py`.
- `free_search_limit.py`, `free_voting.py`, `free_oat_locked.py`, `free_glossary_gated.py`, `free_gated_cta_clicks.py`, `gated_no_writes.py`, `gated_rest_rejected.py`, `lock_cta_a11y.py`.
- `leaderboard_net_updates.py`, `ticker_stress.py`, `ticker_sidebar_focus.py`, `back_scroll_restore.py`, `streak_persistence.py`.

Ship a GitHub Actions workflow `.github/workflows/cls-regression.yml` that runs `cls_vote.py` on PRs.

## 19. Seed data (~60 trends)

Categories: `slang`, `aesthetic`, `meme`, `subculture`, `phrase`. For each term seed: `term`, `slug`, `plain_language` (1 sentence), `origin` (2–4 sentences — do NOT cite "Know Your Meme"), `safety_tips`, 3 `examples` (jsonb array of sentences), `base_price` between 60 and 260, `origin_year`, and 8–24 `trend_popularity` rows describing that term's real trajectory over time.

MUST include: **Slay, Rizzler, Delulu, Skibidi, Low Taper Fade, Chopped Chin, Ragebait, Strawberry Elephant, Irish Exit, Pattern Recognition, Du Bist Gut Genug, Unc, Mog, Goyslop, "I wish I had a free bag of chips"**.

MUST NOT include: Haskell.

## 20. What NOT to build

- **No Stripe / Paddle integration in v1.** Leave `/pricing` buttons as no-op stubs (comment: `// Paid subscriptions are temporarily unavailable.`). No `checkout.return.tsx`, no `payments/webhook.ts`, no `useStripeCheckout`, no `StripeEmbeddedCheckout`, no `PaymentTestModeBanner`, no `.env.development` for payments. Tier is manually set through the `subscriptions` table until a provider is added.
- **No Supabase Edge Functions for app-internal logic.** Use `createServerFn`. Edge Functions only if the user explicitly needs an externally-called webhook that must land inside Supabase's network.
- **No roles on `profiles`.** Roles live only in `user_roles` and are read via `has_role`.
- **No `src/pages/`**, no `entry-client.tsx`, no `entry-server.tsx`, no `src/routes/_app/`. Root layout is `src/routes/__root.tsx` only.
- **No `<a href>` for dynamic routes.** Use `<Link to params={{...}}>`.
- **No hash-anchor "sections" for major content.** Each shareable section gets its own route file with its own `head()`.

---

Build all of the above in one pass. When a decision is ambiguous, prefer WSJ + iOS Liquid Glass aesthetic and server-side enforcement over client-side gating. Ship migrations, seed data, tests, and README together.
