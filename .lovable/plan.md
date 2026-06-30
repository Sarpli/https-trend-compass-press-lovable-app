# Trenslate — Build Plan

A WSJ-style cultural fluency app with live trend ticker, voting, and Pro subscriptions.

## Scope for v1

**Design**: WSJ-inspired newspaper layout — serif headlines (e.g. Playfair Display / Libre Caslon), thin rules, multi-column grid, restrained palette (ink black, newsprint cream, one accent red for the ticker). Works for kids + adults.

**Pages**
- `/` Homepage — live ticker, Daily Edition (featured spotlight), Top Trends sidebar, Voting Leaderboard
- `/trends/$slug` — full trend entry (plain language, origin, safety tips, real examples, vote buttons)
- `/vote` — leaderboards by category (Week / Month / Year / OAT)
- `/glossary` — saved terms (Pro)
- `/archive` — trend archive (Pro)
- `/auth` — sign in / sign up
- `/pricing` — Free vs Pro
- `/account` — subscription, streak, badges

**Voting**
- 4 categories: Week, Month, Year, OAT
- Free: Week + Month only
- Pro: all four; annual subscribers get 2x weighted votes + founding OAT badge
- Ticker price = base + net votes (live via Supabase Realtime)

**Free tier**: 3 searches/day, monthly trend view, daily streak, weekly+monthly voting
**Pro tier** ($4.99/mo, $39.99/yr): unlimited search, full voting, archive, glossary, push notifications flag, early access flag

## Backend (Lovable Cloud / Supabase)

Tables:
- `profiles` (id, display_name, streak_count, last_active_at, is_founding_voter)
- `subscriptions` (user_id, tier: free|pro_monthly|pro_annual, status, current_period_end)
- `trends` (id, slug, term, plain_language, origin, safety_tips, examples jsonb, base_price, created_at)
- `votes` (id, user_id, trend_id, category: week|month|year|oat, direction: up|down, weight, created_at) — unique per (user, trend, category, period)
- `saved_glossary` (user_id, trend_id)
- `searches` (user_id, query, created_at) — for 3/day quota
- `user_roles` (user_id, role) + `has_role()` SECURITY DEFINER

RLS on all; helper function for vote permission (Pro check for year/OAT).

## Payments
Lovable's built-in **Stripe Payments** (no account needed). Two products: monthly $4.99, annual $39.99. Webhook updates `subscriptions`.

## What I'll do this turn after approval
1. Enable Lovable Cloud
2. Build the design system + homepage + trend page + voting UI with seeded demo trends (so the app looks alive immediately)
3. Wire auth + Supabase schema + RLS + realtime ticker
4. Then in a follow-up turn: enable Stripe Payments and wire Pro gating + checkout

## Questions before I start

1. Should I seed ~20 real-ish demo trends (e.g. "rizz", "delulu", "sigma") so the ticker and leaderboards look populated, or leave empty for you to add?
2. Confirm Stripe (built-in, no account needed) is fine for payments — I'll set it up in a follow-up turn after the core app is working.
3. Push notifications: web push only, or skip the actual delivery for v1 and just show a "Pro perk" toggle?
