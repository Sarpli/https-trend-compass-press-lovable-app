import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VoteButtons } from "@/components/VoteButtons";
import { CATEGORY_LABEL } from "@/lib/period";
import { trendImage } from "@/lib/trend-image";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Trenslate — The Daily Edition of Internet Culture" },
      { name: "description", content: "A newspaper-style field guide to slang, memes, and trends. Vote them up or down on a live cultural ticker." },
      { property: "og:title", content: "Trenslate — The Daily Edition of Internet Culture" },
      { property: "og:description", content: "Decode internet culture. Trade trends like stocks." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  // Local-date key in the viewer's own time zone (YYYY-MM-DD).
  // The spotlight rotates once per local calendar day, so each time zone
  // gets its own "today's edition" without a server-side cron.
  const localDateKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: featured } = useQuery({
    queryKey: ["featured", localDateKey],
    queryFn: async () => {
      // Restrict the spotlight pool to the most popular trends only — the
      // top of the live ticker by price. No niche entries; readers in every
      // time zone get a recognizable headline.
      const { data: topScores } = await supabase
        .from("trend_scores")
        .select("slug")
        .order("price", { ascending: false })
        .limit(15);
      const slugs = (topScores ?? [])
        .map((r) => r.slug)
        .filter((s): s is string => !!s);
      if (slugs.length === 0) return null;
      const { data } = await supabase
        .from("trends")
        .select("*")
        .in("slug", slugs);
      // Re-sort by the ranking we got from trend_scores so the hash is stable.
      const pool = (data ?? []).slice().sort(
        (a, b) => slugs.indexOf(a.slug) - slugs.indexOf(b.slug),
      );
      if (pool.length === 0) return null;
      // Editorial overrides — pin specific local dates to a chosen trend.
      const PINNED: Record<string, string> = {
        [localDateKey]: "67",
      };
      const pinSlug = PINNED[localDateKey];
      if (pinSlug) {
        const pinned = pool.find((p) => p.slug === pinSlug);
        if (pinned) return pinned;
      }
      let h = 2166136261;
      for (let i = 0; i < localDateKey.length; i++) {
        h ^= localDateKey.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % pool.length;
      return pool[idx];
    },
    staleTime: 1000 * 60 * 60, // 1h — date key change forces a fresh pick
  });

  const { data: top = [] } = useQuery({
    queryKey: ["top-trends"],
    queryFn: async () => {
      const { data } = await supabase
        .from("trend_scores")
        .select("*")
        .order("price", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ["leaderboard", "week"],
    queryFn: async () => {
      const { data } = await supabase
        .from("trend_scores")
        .select("*")
        .order("net_votes", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: stories = [] } = useQuery({
    queryKey: ["front-stories"],
    queryFn: async () => {
      const { data } = await supabase
        .from("trends")
        .select("id,slug,term,plain_language,category,image_url")
        .neq("featured", true)
        .limit(6);
      return data ?? [];
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: "/archive", search: { q: q.trim() } });
        }}
        className="rule-double py-5 mb-8 flex flex-col sm:flex-row gap-3 sm:items-center"
      >
        <div className="flex-1">
          <div className="ui small-caps text-[10px] text-accent-red mb-1">Look it up</div>
          <div className="display text-2xl md:text-3xl font-bold leading-tight">
            What does it mean?
          </div>
        </div>
        <div className="flex gap-2 sm:w-[420px]">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="rizz, 67, mob wife…"
              className="w-full border border-ink/60 bg-background pl-10 pr-3 py-2 ui focus:outline-none focus:border-accent-red"
            />
          </div>
          <button className="ui small-caps text-xs bg-ink text-newsprint px-5">Search</button>
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Featured spotlight */}
        <section className="lg:col-span-8">
          <div className="text-xs ui small-caps text-accent-red mb-2">Daily Edition · Trend Spotlight</div>
          {featured ? (
            <article className="rule-bottom pb-8">
              <Link to="/trends/$slug" params={{ slug: featured.slug }}>
                <img
                  src={trendImage(featured, 1200, 700)}
                  alt={featured.term}
                  loading="eager"
                  className="w-full aspect-[16/9] object-cover grayscale-[20%] mb-4 border border-ink/20"
                />
                <h2 className="display text-5xl md:text-6xl font-black leading-[0.95] mb-4 hover:text-accent-red transition-colors">
                  {featured.term}
                </h2>
              </Link>
              <p className="text-xs ui small-caps text-muted-foreground mb-4">
                {featured.category} · Filed today
              </p>
              <p className="text-lg leading-relaxed mb-3 first-letter:display first-letter:text-6xl first-letter:font-black first-letter:float-left first-letter:mr-2 first-letter:leading-[0.85]">
                {featured.plain_language}
              </p>
              <p className="text-base leading-relaxed text-muted-foreground">
                <span className="small-caps ui text-xs text-ink">Origin —</span> {featured.origin}
              </p>
              <div className="mt-5 flex items-center gap-4">
                <Link to="/trends/$slug" params={{ slug: featured.slug }} className="ui small-caps text-xs underline">
                  Read the full entry →
                </Link>
                <div className="flex items-center gap-2">
                  <span className="ui text-xs small-caps text-muted-foreground">Vote week:</span>
                  <VoteButtons trendId={featured.id} category="week" compact />
                </div>
              </div>
            </article>
          ) : (
            <div className="h-64 rule-bottom" />
          )}

          {/* Front-page columns */}
          <div className="grid grid-cols-2 gap-4 mt-8">
            {stories.map((s) => (
              <article key={s.id} className="rule-top pt-3">
                <div className="text-[9px] ui small-caps text-accent-red mb-1">{s.category}</div>
                <Link to="/trends/$slug" params={{ slug: s.slug }}>
                  <img
                    src={trendImage(s, 400, 240)}
                    alt={s.term}
                    loading="lazy"
                    className="w-full aspect-[5/3] object-cover grayscale-[20%] mb-2 border border-ink/20"
                  />
                  <h3 className="display text-base sm:text-lg font-bold leading-tight hover:text-accent-red transition-colors">
                    {s.term}
                  </h3>
                </Link>
                <p className="mt-1 text-xs leading-snug text-foreground/90 line-clamp-2">
                  {s.plain_language}
                </p>
                <Link
                  to="/trends/$slug"
                  params={{ slug: s.slug }}
                  className="ui small-caps text-[9px] mt-1 inline-block underline"
                >
                  Continue reading
                </Link>
              </article>
            ))}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="lg:col-span-4 space-y-8">
          <section className="rule-double py-4">
            <h3 className="display text-xl font-bold mb-3">Top Trends</h3>
            <ol className="space-y-2">
              {top.map((t, i) => (
                <li key={t.trend_id} className="flex items-baseline gap-3 text-sm">
                  <span className="display text-xl font-bold text-accent-red w-6 text-right tabular-nums">
                    {i + 1}
                  </span>
                  <Link to="/trends/$slug" params={{ slug: t.slug ?? "" }} className="flex-1 hover:underline">
                    {t.term}
                  </Link>
                  <span className="ui text-xs tabular-nums text-muted-foreground">{Number(t.price).toFixed(0)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rule-top pt-4">
            <div className="text-xs ui small-caps text-accent-red mb-2">Voting Floor</div>
            <h3 className="display text-xl font-bold mb-3">{CATEGORY_LABEL.week} — Leaderboard</h3>
            <ul className="space-y-3">
              {leaderboard.map((t, i) => (
                <li key={t.trend_id} className="flex items-center justify-between gap-3 rule-bottom pb-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="display text-lg font-bold w-5 text-right">{i + 1}</span>
                    <Link to="/trends/$slug" params={{ slug: t.slug ?? "" }} className="truncate hover:underline text-sm">
                      {t.term}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`ui text-xs tabular-nums ${Number(t.net_votes) >= 0 ? "text-ticker-up" : "text-ticker-down"}`}>
                      {Number(t.net_votes) > 0 ? "+" : ""}{t.net_votes}
                    </span>
                    <VoteButtons trendId={t.trend_id ?? ""} category="week" compact />
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/vote" className="ui small-caps text-xs underline mt-3 inline-block">
              Open the full voting floor →
            </Link>
          </section>

          <section className="bg-ink text-newsprint p-5">
            <div className="ui small-caps text-xs text-accent-red mb-1">Subscribe</div>
            <h3 className="display text-2xl font-bold leading-tight mb-2">
              Become a Trenslate Pro.
            </h3>
            <p className="text-sm text-newsprint/80 mb-3">
              Unlimited search. Vote in Trend of the Year and All Time. Save your personal glossary.
            </p>
            <Link to="/pricing" className="ui small-caps text-xs underline">View plans →</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
