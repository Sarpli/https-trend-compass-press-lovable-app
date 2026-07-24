
REVOKE SELECT ON public.vote_events FROM anon, authenticated;
GRANT SELECT (id, trend_id, created_at, net_delta, event_type) ON public.vote_events TO anon, authenticated;
