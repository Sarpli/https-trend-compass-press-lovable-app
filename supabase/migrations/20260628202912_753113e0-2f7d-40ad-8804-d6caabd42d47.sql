REVOKE EXECUTE ON FUNCTION public.mark_trend_learned(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_trend_learned(uuid, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bump_streak_on_search() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_streak_on_search() TO authenticated;