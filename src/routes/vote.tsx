import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VoteButtons } from "@/components/VoteButtons";
import { CategoryChart } from "@/components/CategoryChart";
import { CATEGORY_LABEL, currentPeriodKey } from "@/lib/period";
import { useAuth } from "@/lib/auth";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/vote")({
  head: () => ({
    meta: [
      { title: "Voting Floor — Trenslate" },
      { name: "description", content: "Vote up or down on internet trends across four time horizons." },
    ],
  }),
  component: VotePage,
});

type Cat = "week" | "month" | "year" | "oat";
const CATS: Cat[] = ["week", "month", "year", "oat"];

function VotePage() {
  const { isPro } = useAuth();
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="text-xs ui small-caps text-accent-red mb-1">Voting Floor</div>
      <h1 className="display text-5xl font-black mb-2">The Leaderboards</h1>
      <p className="text-muted-foreground max-w-2xl mb-8">
        Votes move the cultural ticker in real time. Weekly and monthly polls are open to all readers.
        Year and All-Time polls are reserved for Pro subscribers.
      </p>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-10">
        {CATS.map((cat) => (
          <Board key={cat} category={cat} locked={(cat === "year" || cat === "oat") && !isPro} />
        ))}
      </div>
    </div>
  );
}

function Board({ category, locked }: { category: Cat; locked: boolean }) {
  const periodKey = currentPeriodKey(category);
  const { data: rows = [] } = useQuery({
    queryKey: ["leaderboard", category, periodKey],
    queryFn: async () => {
      const { data: trends } = await supabase.from("trends").select("id,slug,term,base_price");
      const { data: tallies } = await supabase.rpc("get_vote_tallies", {
        _category: category,
        _period_key: periodKey,
      });
      const tally = new Map<string, number>();
      (tallies ?? []).forEach((t: { trend_id: string; net_votes: number }) => {
        tally.set(t.trend_id, t.net_votes);
      });
      const enriched = (trends ?? []).map((t) => ({
        ...t,
        net: tally.get(t.id) ?? 0,
        price: Number(t.base_price) + (tally.get(t.id) ?? 0),
      }));
      enriched.sort((a, b) => b.net - a.net);
      return enriched.slice(0, 10);
    },
  });

  return (
    <section className="rule-top pt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="display text-2xl font-bold">{CATEGORY_LABEL[category]}</h2>
        {locked && (
          <span className="ui small-caps text-xs text-accent-red inline-flex items-center gap-1">
            <Lock className="w-3 h-3" /> Pro
          </span>
        )}
      </div>
      <div className="md:hidden">
        <CategoryChart category={category} periodKey={periodKey} />
      </div>
      <ol className="space-y-2">
        {rows.map((t, i) => (
          <li key={t.id} className="flex items-center gap-3 rule-bottom pb-2">
            <span className="display text-xl font-bold w-6 text-right text-accent-red tabular-nums">{i + 1}</span>
            <Link to="/trends/$slug" params={{ slug: t.slug }} className="flex-1 hover:underline">{t.term}</Link>
            <span className={`ui text-xs tabular-nums ${t.net >= 0 ? "text-ticker-up" : "text-ticker-down"}`}>
              {t.net > 0 ? "+" : ""}{t.net}
            </span>
            <VoteButtons trendId={t.id} category={category} compact />
          </li>
        ))}
      </ol>
    </section>
  );
}