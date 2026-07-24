import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VoteButtons } from "@/components/VoteButtons";
import { CATEGORY_LABEL } from "@/lib/period";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Bookmark, BookmarkCheck, ShieldAlert } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { TrendCover } from "@/components/TrendCover";
import { PriceChart } from "@/components/PriceChart";
import { LivePriceBar } from "@/components/LivePriceBar";
import { LearnedBanner } from "@/components/LearnedBanner";
import { ReportTrend } from "@/components/ReportTrend";
import { getTrendHistoryStats, trendHistoryQueryOptions } from "@/lib/trend-history";

export const Route = createFileRoute("/trends/$slug")({
  loader: async ({ params, context }) => {
    const { data, error } = await supabase
      .from("trends")
      .select("*")
      .eq("slug", params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    // Kick off the price-history fetch in parallel (don't await) so it lands
    // by the time <PriceChart /> / <LivePriceBar /> mount instead of only
    // starting after first render.
    void context.queryClient.prefetchQuery(trendHistoryQueryOptions(data.id));
    return { trend: data };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.trend.term} — Trendslated` },
          { name: "description", content: loaderData.trend.plain_language },
          { property: "og:title", content: `${loaderData.trend.term} — Trendslated` },
          { property: "og:description", content: loaderData.trend.plain_language },
        ]
      : [],
  }),
  component: TrendPage,
  errorComponent: () => (
    <div className="max-w-3xl mx-auto p-10 text-center">
      <h1 className="display text-3xl font-bold mb-2">Couldn't load this entry.</h1>
      <div className="flex justify-center gap-3 mt-4">
        <button
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="ui small-caps text-xs underline"
        >
          Try again
        </button>
        <Link to="/" className="ui small-caps text-xs underline">← Back to the front page</Link>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="max-w-3xl mx-auto p-10 text-center">
      <div className="ui small-caps text-xs text-accent-red mb-2">404 · Not in the archive</div>
      <h1 className="display text-4xl font-bold mb-3">This trend hasn't been filed yet.</h1>
      <Link to="/" className="ui small-caps text-xs underline">← Back to the front page</Link>
    </div>
  ),
});

function TrendPage() {
  const { trend } = Route.useLoaderData();
  const { user, isPro } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();

  const { data: historySeries } = useQuery(trendHistoryQueryOptions(trend.id));

  const { data: saved } = useQuery({
    queryKey: ["saved", trend.id, user?.id],
    enabled: !!user && isPro,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_glossary")
        .select("trend_id")
        .eq("trend_id", trend.id)
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data;
    },
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in to save trends");
      if (!isPro) throw new Error("Saving a glossary is a Pro feature");
      if (saved) {
        await supabase.from("saved_glossary").delete().eq("user_id", user.id).eq("trend_id", trend.id);
      } else {
        await supabase.from("saved_glossary").insert({ user_id: user.id, trend_id: trend.id });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved", trend.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const examples = (trend.examples as string[]) ?? [];
  const historyStats = getTrendHistoryStats(historySeries, Number(trend.base_price));
  const price = historyStats.last;

  return (
    <article className="max-w-4xl mx-auto px-6 py-8">
      <button
        onClick={() => router.history.back()}
        className="ui small-caps text-xs inline-flex items-center gap-1.5 mb-3 text-muted-foreground hover:text-accent-red transition-colors"
        aria-label="Go back to previous page"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <div className="text-xs ui small-caps text-accent-red mb-2">
        Trend Entry · {trend.category}
      </div>
      <h1 className="display text-5xl md:text-7xl font-black leading-[0.95] mb-4">{trend.term}</h1>
      <TrendCover
        trend={trend}
        width={1400}
        height={800}
        eager
        fetchpriority="high"
        sizes="(min-width: 1024px) 900px, 100vw"
        className="w-full aspect-[16/9] mb-5 border border-ink/20"
      />
      <p className="text-xl leading-relaxed mb-6">{trend.plain_language}</p>

      <div className="rule-double py-3 my-6 flex flex-wrap items-center gap-6 ui text-sm">
        <div>
          <div className="small-caps text-xs text-muted-foreground">Ticker</div>
          <div className="display text-2xl font-bold tabular-nums">{price.toFixed(0)}</div>
        </div>
        <div>
          <div className="small-caps text-xs text-muted-foreground">24h move</div>
          <div className={`display text-2xl font-bold tabular-nums ${historyStats.dayPct >= 0 ? "text-ticker-up" : "text-ticker-down"}`}>
            {historyStats.dayPct >= 0 ? "+" : ""}{historyStats.day.toFixed(0)} · {historyStats.dayPct >= 0 ? "+" : ""}{historyStats.dayPct.toFixed(2)}%
          </div>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => toggleSave.mutate()}
            className="ui small-caps text-xs inline-flex items-center gap-2 border border-ink/30 px-3 py-2 hover:bg-ink hover:text-newsprint transition-colors"
          >
            {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            {saved ? "Saved" : isPro ? "Save to glossary" : "Save (Pro)"}
          </button>
        </div>
      </div>

      <div className="my-6">
        <LivePriceBar trendId={trend.id} term={trend.term} basePrice={Number(trend.base_price)} />
        <PriceChart trendId={trend.id} basePrice={Number(trend.base_price)} />
      </div>

      <div className="grid md:grid-cols-12 gap-8 mt-4">
        <div className="md:col-span-8 space-y-8">
          <section>
            <h2 className="display text-2xl font-bold mb-2 rule-bottom pb-1">Origin & context</h2>
            <p className="leading-relaxed">{trend.origin}</p>
          </section>

          <section>
            <h2 className="display text-2xl font-bold mb-2 rule-bottom pb-1 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-accent-red" /> Safety & nuance
            </h2>
            <p className="leading-relaxed">{trend.safety_tips}</p>
          </section>

          <section>
            <h2 className="display text-2xl font-bold mb-2 rule-bottom pb-1">In the wild</h2>
            <ul className="space-y-2">
              {examples.map((ex, i) => (
                <li key={i} className="border-l-4 border-accent-red pl-4 italic text-foreground/90">
                  "{ex}"
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="md:col-span-4 space-y-6">
          <section className="bg-card border border-ink/20 p-5">
            <h3 className="display text-lg font-bold mb-3">Cast your vote</h3>
            <div className="space-y-3 ui text-sm">
              {(["week", "month", "year", "oat"] as const).map((cat) => (
                <div key={cat} className="flex items-center justify-between gap-2">
                  <span className="small-caps text-xs">{CATEGORY_LABEL[cat]}</span>
                  <VoteButtons trendId={trend.id} category={cat} wide />
                </div>
              ))}
            </div>
            {!user && (
              <button
                onClick={() => router.navigate({ to: "/auth" })}
                className="ui small-caps text-xs underline mt-4 block"
              >
                Sign in to vote →
              </button>
            )}
          </section>
        </aside>
      </div>
      <LearnedBanner trendId={trend.id} />
      <div className="rule-top mt-8 pt-4 flex justify-end">
        <ReportTrend trendId={trend.id} />
      </div>
    </article>
  );
}