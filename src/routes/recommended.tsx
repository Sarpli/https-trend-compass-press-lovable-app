import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { TrendCover } from "@/components/TrendCover";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/recommended")({
  head: () => ({
    meta: [
      { title: "Recommended terms — Trendslated" },
      {
        name: "description",
        content: "Hand-picked trends to learn today and start your streak on Trendslated.",
      },
    ],
  }),
  component: Recommended,
});

const PICKS = 10;

function Recommended() {
  const { user } = useAuth();

  const { data: picks, isLoading } = useQuery({
    queryKey: ["recommended-streak-picks", user?.id],
    enabled: true,
    queryFn: async () => {
      // 1) Grab the most popular trends from the live ticker.
      const { data: scores } = await supabase
        .from("trend_scores")
        .select("trend_id, slug, term, net_votes, price")
        .order("price", { ascending: false })
        .limit(50);
      if (!scores || scores.length === 0) return [];

      const ids = scores.map((s) => s.trend_id).filter((id): id is string => !!id);
      const { data: trends } = await supabase
        .from("trends")
        .select("id, slug, term, category, plain_language, origin, image_url")
        .in("id", ids);

      const trendById = new Map((trends ?? []).map((t) => [t.id, t]));
      let ordered = scores
        .map((s) => {
          const t = trendById.get(s.trend_id ?? "");
          if (!t) return null;
          return { ...t, net_votes: s.net_votes, price: s.price };
        })
        .filter((t): t is NonNullable<typeof t> => !!t);

      // 2) If signed in, hide terms already marked as learned so the list feels fresh.
      if (user) {
        const { data: learned } = await supabase
          .from("learned_trends")
          .select("trend_id")
          .eq("user_id", user.id)
          .in(
            "trend_id",
            ordered.map((t) => t.id),
          );
        const learnedIds = new Set((learned ?? []).map((l) => l.trend_id));
        ordered = ordered.filter((t) => !learnedIds.has(t.id));
      }

      return ordered.slice(0, PICKS);
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-2">Streak starter</div>
      <h1 className="display text-4xl md:text-5xl font-black mb-3">
        Terms to learn today
      </h1>
      <p className="text-base md:text-lg text-muted-foreground max-w-2xl mb-8">
        Pick a trending term, open its entry, and tap the flame banner to mark it
        learned. Your streak starts today.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !picks || picks.length === 0 ? (
        <div className="glass glass-sheen p-8 rounded-sm text-center">
          <div className="display text-2xl font-black mb-2">All caught up</div>
          <p className="text-muted-foreground mb-4">
            You've already learned every trending term on our list. Head back to
            the front page to discover more.
          </p>
          <Link
            to="/"
            className="ui small-caps text-xs bg-accent-red text-accent-foreground px-4 py-2 inline-block"
          >
            Read the front page
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {picks.map((t) => (
            <article
              key={t.id}
              className="glass glass-sheen rounded-sm overflow-hidden border border-ink/10 hover:border-accent-red/40 transition-colors"
            >
              <Link to="/trends/$slug" params={{ slug: t.slug ?? "" }}>
                <TrendCover
                  trend={t}
                  width={400}
                  height={240}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="w-full aspect-[5/3]"
                />
              </Link>
              <div className="p-4">
                <div className="text-[9px] ui small-caps text-accent-red mb-1">
                  {t.category}
                </div>
                <Link
                  to="/trends/$slug"
                  params={{ slug: t.slug ?? "" }}
                  className="block"
                >
                  <h2 className="display text-xl font-bold leading-tight hover:text-accent-red transition-colors mb-2">
                    {t.term}
                  </h2>
                </Link>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {t.plain_language}
                </p>
                <div className="flex items-center justify-between">
                  <Link
                    to="/trends/$slug"
                    params={{ slug: t.slug ?? "" }}
                    className="ui small-caps text-[10px] underline"
                  >
                    Learn this term
                  </Link>
                  <span className="ui text-[10px] tabular-nums text-muted-foreground">
                    {Number(t.price).toFixed(0)} pts
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="rule-top mt-10 pt-6 flex flex-wrap items-center gap-3">
        <Link
          to="/vote"
          className="ui small-caps text-xs border border-ink/40 px-4 py-2 hover:bg-ink hover:text-newsprint transition-colors"
        >
          Or cast a vote instead →
        </Link>
      </div>
    </div>
  );
}
