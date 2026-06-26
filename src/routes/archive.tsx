import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Search, Sparkles } from "lucide-react";
import { trendImage } from "@/lib/trend-image";
import { TrendCover } from "@/components/TrendCover";
import { aiSearchTrends } from "@/lib/ai-search.functions";

export const Route = createFileRoute("/archive")({
  head: () => ({ meta: [{ title: "Trend Archive — Trenslate" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === "string" ? s.q : "" }),
  component: Archive,
});

const DAILY_LIMIT = 3;

function Archive() {
  const { user, isPro } = useAuth();
  const { q: initialQ } = Route.useSearch();
  const [q, setQ] = useState(initialQ ?? "");
  const [submitted, setSubmitted] = useState(initialQ ?? "");
  const [useAI, setUseAI] = useState(true);
  const aiSearch = useServerFn(aiSearchTrends);

  useEffect(() => {
    if (initialQ && initialQ !== submitted) {
      setQ(initialQ);
      setSubmitted(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const { data: searchCount = 0 } = useQuery({
    queryKey: ["searches", user?.id],
    enabled: !!user && !isPro,
    queryFn: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("searches")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .gte("created_at", since.toISOString());
      return count ?? 0;
    },
  });

  const { data: trends = [], isFetching } = useQuery({
    queryKey: ["archive", submitted, useAI],
    queryFn: async () => {
      const { data: all } = await supabase.from("trends").select("*").order("term");
      const rows = all ?? [];
      if (!submitted) return rows;

      const needle = submitted.toLowerCase();
      const keywordHits = rows.filter((t) =>
        t.term?.toLowerCase().includes(needle) ||
        t.category?.toLowerCase().includes(needle) ||
        t.plain_language?.toLowerCase().includes(needle),
      );

      if (!useAI) return keywordHits;

      try {
        const { slugs } = await aiSearch({ data: { query: submitted } });
        const set = new Set([...keywordHits.map((t) => t.slug), ...slugs]);
        // Preserve AI ordering for AI-only hits, then keyword hits.
        const ordered = [
          ...slugs.map((s) => rows.find((r) => r.slug === s)).filter(Boolean),
          ...keywordHits.filter((t) => !slugs.includes(t.slug)),
        ];
        return ordered.filter((t, i, a) => t && a.findIndex((x) => x!.slug === t!.slug) === i) as typeof rows;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI search failed";
        toast.error(msg);
        return keywordHits;
      }
    },
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { setSubmitted(q); return; }
    if (!isPro && searchCount >= DAILY_LIMIT) {
      toast.error(`Free tier limit: ${DAILY_LIMIT} searches per day. Upgrade for unlimited.`);
      return;
    }
    if (user && q) {
      await supabase.from("searches").insert({ user_id: user.id, query: q });
    }
    setSubmitted(q);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">The Archive</div>
      <h1 className="display text-5xl font-black mb-3">Every trend, on file.</h1>
      <p className="text-muted-foreground mb-6">
        Search the Trenslate archive. {!isPro && user && (
          <span className="ui text-xs ml-2">
            ({searchCount}/{DAILY_LIMIT} searches today — <Link to="/pricing" className="underline">go Pro</Link> for unlimited)
          </span>
        )}
      </p>

      <form onSubmit={handleSearch} className="flex gap-2 mb-8 max-w-xl">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a term, vibe, or category (try “fashion”)…"
            className="w-full border border-ink/40 bg-background pl-10 pr-3 py-2 ui focus:outline-none focus:border-accent-red"
          />
        </div>
        <button className="ui small-caps text-xs bg-ink text-newsprint px-5">Search</button>
      </form>

      <label className="flex items-center gap-2 text-xs ui mb-6 -mt-4 cursor-pointer select-none">
        <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
        <Sparkles className="w-3 h-3 text-accent-red" />
        <span>AI-assisted search {isFetching && submitted ? "· thinking…" : ""}</span>
      </label>

      <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {trends.map((t) => (
          <li key={t.id} className="rule-top pt-3">
            <Link to="/trends/$slug" params={{ slug: t.slug }}>
              <TrendCover
                trend={t}
                width={600}
                height={360}
                sizes="(min-width: 1024px) 360px, (min-width: 768px) 50vw, 100vw"
                className="w-full aspect-[5/3] object-cover grayscale-[20%] mb-2 border border-ink/20"
              />
            </Link>
            <div className="ui small-caps text-[10px] text-accent-red">{t.category}</div>
            <Link to="/trends/$slug" params={{ slug: t.slug }}>
              <h3 className="display text-2xl font-bold hover:text-accent-red">{t.term}</h3>
            </Link>
            <p className="text-sm mt-1 text-foreground/90 line-clamp-3">{t.plain_language}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}