import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trendHistoryQueryOptions } from "@/lib/trend-history";
import { useLocalDateKey } from "@/lib/use-local-date";
import { LIVE_PCT_PER_NET_VOTE, parseNetDelta, TREND_VOTE_IMPACT_EVENT, type TrendVoteImpactDetail } from "@/lib/live-vote";

const PENDING_IMPACT_MS = 2500;

type VoteEventRow = {
  id: number;
  created_at: string;
  net_delta: number | string | null;
  event_type: string | null;
};

type PendingImpact = {
  id: string;
  netDelta: number;
  createdAt: number;
};

export function LivePriceBar({
  trendId,
  term,
  basePrice,
}: {
  trendId: string;
  term: string;
  basePrice: number;
}) {
  const qc = useQueryClient();
  const { date: localDate } = useLocalDateKey();
  const { data, isFetched } = useQuery(trendHistoryQueryOptions(trendId));
  const dayStartIso = useMemo(() => new Date(`${localDate}T00:00:00`).toISOString(), [localDate]);

  const liveQueryKey = useMemo(
    () => ["live-traction", trendId, localDate] as const,
    [trendId, localDate],
  );

  const { data: dailyEvents } = useQuery({
    queryKey: liveQueryKey,
    queryFn: async () => {
      const { data: rows, error } = await (supabase.from("vote_events") as any)
        .select("id,created_at,net_delta,event_type")
        .eq("trend_id", trendId)
        .gte("created_at", dayStartIso)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (rows ?? []) as VoteEventRow[];
    },
    staleTime: 5_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Daily open = the first historical price this component sees for the local
  // day. Keep it locked so later chart/realtime refetches don't move the goal
  // posts; traction starts at exactly 0.00% each day.
  const baselineFromHistory = useMemo(() => {
    const series = data ?? [];
    return series.length ? Number(series[series.length - 1].price) : Number(basePrice);
  }, [data, basePrice]);
  const [dailyOpen, setDailyOpen] = useState<number | null>(null);
  useEffect(() => setDailyOpen(null), [trendId, localDate]);
  useEffect(() => {
    if (!isFetched) return;
    setDailyOpen((prev) => prev ?? baselineFromHistory);
  }, [baselineFromHistory, isFetched]);
  const baseline = dailyOpen ?? baselineFromHistory;

  // Ephemeral signed impacts make the section respond instantly while the
  // backend event stream catches up. They expire quickly so the persisted daily
  // vote feed becomes the source of truth after navigation/refetch.
  const [pendingImpacts, setPendingImpacts] = useState<PendingImpact[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const lastOwnVoteRef = useRef<number>(0);
  const pushPendingImpact = useCallback((netDelta: number) => {
    if (!Number.isFinite(netDelta) || netDelta === 0) return;
    const createdAt = Date.now();
    const id = `${createdAt}-${Math.random().toString(36).slice(2)}`;
    setPendingImpacts((prev) => [...prev, { id, netDelta, createdAt }]);
    const timer = window.setTimeout(() => {
      setPendingImpacts((prev) => prev.filter((impact) => impact.id !== id));
      timersRef.current.delete(id);
    }, PENDING_IMPACT_MS);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    setPendingImpacts([]);
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, [trendId, localDate]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    const onOwnVote = (e: Event) => {
      const detail = (e as CustomEvent<TrendVoteImpactDetail>).detail;
      if (!detail || detail.trendId !== trendId) return;
      lastOwnVoteRef.current = Date.now();
      pushPendingImpact(detail.netDelta);
      qc.invalidateQueries({ queryKey: liveQueryKey });
    };
    window.addEventListener(TREND_VOTE_IMPACT_EVENT, onOwnVote);
    const ch = supabase
      .channel(`live-bar-${trendId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_events", filter: `trend_id=eq.${trendId}` },
        (payload) => {
          const netDelta = parseNetDelta((payload.new as { net_delta?: unknown }).net_delta);
          if (netDelta !== 0 && Date.now() - lastOwnVoteRef.current >= 1500) {
            pushPendingImpact(netDelta);
          }
          qc.invalidateQueries({ queryKey: liveQueryKey });
        },
      )
      .subscribe();
    return () => {
      window.removeEventListener(TREND_VOTE_IMPACT_EVENT, onOwnVote);
      supabase.removeChannel(ch);
    };
  }, [trendId, liveQueryKey, pushPendingImpact, qc]);

  // Pulse the live dot every couple seconds.
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 1100);
    return () => clearInterval(id);
  }, []);

  const dailyImpacts = useMemo(() => {
    const persistedRows = dailyEvents ?? [];
    const persisted = persistedRows
      .map((row) => ({ id: row.id, at: new Date(row.created_at).getTime(), netDelta: parseNetDelta(row.net_delta) }))
      .filter((row) => row.netDelta !== 0);
    const consumed = new Set<number>();
    const stillPending = pendingImpacts.filter((impact) => {
      const match = persisted.find(
        (row) =>
          !consumed.has(row.id) &&
          row.netDelta === impact.netDelta &&
          row.at >= impact.createdAt - 1000,
      );
      if (match) {
        consumed.add(match.id);
        return false;
      }
      return true;
    });
    return [...persisted.map((row) => row.netDelta), ...stillPending.map((impact) => impact.netDelta)];
  }, [dailyEvents, pendingImpacts]);

  // At local midnight this starts at zero traction. Only signed vote impacts
  // from today's event stream move it away from 0.00%.
  const liveSeries = useMemo(() => {
    const out: number[] = [baseline];
    let runningPct = 0;
    for (const impact of dailyImpacts) {
      runningPct += impact * LIVE_PCT_PER_NET_VOTE;
      out.push(baseline * (1 + runningPct / 100));
    }
    return out;
  }, [baseline, dailyImpacts]);

  const last = liveSeries[liveSeries.length - 1];
  const open = liveSeries[0];
  const change = last - open;
  const changePct = open ? (change / open) * 100 : 0;
  const up = change > 0;
  const down = change < 0;
  const high = Math.max(...liveSeries);
  const low = Math.min(...liveSeries);
  const netFlow = dailyImpacts.reduce((sum, impact) => sum + impact, 0);
  const voteEvents = dailyImpacts.length;

  return (
    <div className="glass glass-sheen border border-ink/25 px-4 py-3 mb-4 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full transition-opacity duration-700"
          style={{
            background: "var(--ticker-up)",
            opacity: pulse ? 1 : 0.25,
            boxShadow: "0 0 8px var(--ticker-up)",
          }}
        />
        <span className="ui small-caps text-[10px] text-muted-foreground">
          Today live
        </span>
        <span className="display font-black tracking-tight uppercase text-sm truncate">
          {term}
        </span>
      </div>

      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="display text-2xl font-black">{last.toFixed(2)}</span>
        <span
          className={`ui text-xs font-semibold ${
            up ? "text-ticker-up" : down ? "text-ticker-down" : "text-muted-foreground"
          }`}
        >
          {up ? "▲" : down ? "▼" : "•"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}
          {changePct.toFixed(2)}%)
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 ui small-caps text-[10px] text-muted-foreground tabular-nums">
        <span>
          Daily flow{" "}
          <span className={`font-semibold ${netFlow > 0 ? "text-ticker-up" : netFlow < 0 ? "text-ticker-down" : "text-foreground"}`}>
            {netFlow > 0 ? "+" : ""}{netFlow.toFixed(0)}
          </span>
        </span>
        <span>
          Events <span className="font-semibold text-foreground">{voteEvents}</span>
        </span>
        <span>
          Range <span className="font-semibold text-foreground">{low.toFixed(2)} – {high.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );
}