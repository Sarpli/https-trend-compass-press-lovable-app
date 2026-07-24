import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Search, Sparkles } from "lucide-react";
import { TrendCover } from "@/components/TrendCover";
import { LearnedFlag } from "@/components/LearnedFlag";
import { aiSearchTrends } from "@/lib/ai-search.functions";

export const Route = createFileRoute("/archive")({
  head: () => ({ meta: [{ title: "Trend Archive — Trendslated" }] }),
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
  const qc = useQueryClient();

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
    enabled: isPro,
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

      // Retry the AI call up to 3 times with exponential backoff
      // (500ms, 1000ms, 2000ms). Each attempt is bounded by an 8s timeout.
      const MAX_ATTEMPTS = 3;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const aiPromise = aiSearch({ data: { query: submitted } });
          const timeout = new Promise<{ slugs: string[] }>((_, rej) =>
            setTimeout(() => rej(new Error("AI search timed out")), 8000),
          );
          const { slugs } = await Promise.race([aiPromise, timeout]);
          const ordered = [
            ...slugs.map((s) => rows.find((r) => r.slug === s)).filter(Boolean),
            ...keywordHits.filter((t) => !slugs.includes(t.slug)),
          ];
          return ordered.filter((t, i, a) => t && a.findIndex((x) => x!.slug === t!.slug) === i) as typeof rows;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[archive] AI search attempt ${attempt}/${MAX_ATTEMPTS} failed:`, msg);
          if (attempt < MAX_ATTEMPTS) {
            const backoff = 500 * 2 ** (attempt - 1); // 500, 1000, 2000
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }
      const finalMsg = lastErr instanceof Error ? lastErr.message : "AI search failed";
      toast.error(`AI search unavailable — showing keyword results. (${finalMsg})`);
      return keywordHits;
    },
  });

  if (!isPro) return <ArchivePaywall signedIn={!!user} />;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { setSubmitted(q); return; }
    if (!isPro && searchCount >= DAILY_LIMIT) {
      toast.error(`Free tier limit: ${DAILY_LIMIT} searches per day. Upgrade for unlimited.`);
      return;
    }
    if (user && q) {
      await supabase.from("searches").insert({ user_id: user.id, query: q });
      qc.invalidateQueries({ queryKey: ["searches", user.id] });
    }
    setSubmitted(q);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">The Archive</div>
      <h1 className="display text-5xl font-black mb-3">Every trend, on file.</h1>
      <p className="text-muted-foreground mb-6">
        Search the Trendslated archive. {!isPro && user && (
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
                className="w-full aspect-[5/3] mb-2 border border-ink/20"
              />
            </Link>
            <div className="ui small-caps text-[10px] text-accent-red">{t.category}</div>
            <Link to="/trends/$slug" params={{ slug: t.slug }}>
              <h3 className="display text-2xl font-bold hover:text-accent-red">{t.term}</h3>
            </Link>
            <LearnedFlag trendId={t.id} className="mt-1" />
            <p className="text-sm mt-1 text-foreground/90 line-clamp-3">{t.plain_language}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArchivePaywall({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="text-xs ui small-caps text-accent-red mb-2">Subscribers Only</div>
      <h1 className="display text-5xl md:text-6xl font-black leading-[1.05] mb-4">
        The Archive is a Pro privilege.
      </h1>
      <p className="rule-top pt-4 text-lg text-foreground/90 mb-8 max-w-2xl">
        Free readers get today’s Front Page — the terms in circulation right now.
        Pro members unlock the full back catalog: every term we’ve ever filed,
        searchable without limit, with AI-assisted lookup and complete price
        history on each entry.
      </p>

      <div className="grid md:grid-cols-2 gap-6 mb-10">
        <div className="border border-ink/30 p-5">
          <div className="ui small-caps text-[10px] text-muted-foreground mb-2">Free</div>
          <h2 className="display text-2xl font-bold mb-2">The Front Page</h2>
          <ul className="text-sm space-y-1 text-foreground/90">
            <li>· Today’s rotating spotlight</li>
            <li>· Daily briefing of trends in play</li>
            <li>· 3 archive searches per day</li>
          </ul>
        </div>
        <div className="border-2 border-accent-red p-5 bg-accent-red/[0.04]">
          <div className="ui small-caps text-[10px] text-accent-red mb-2">Pro</div>
          <h2 className="display text-2xl font-bold mb-2">The Full Archive</h2>
          <ul className="text-sm space-y-1 text-foreground/90">
            <li>· Every term, ever — fully searchable</li>
            <li>· Unlimited AI-assisted search</li>
            <li>· After Hours dark mode & extras</li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/pricing"
          className="ui small-caps text-xs bg-accent-red text-white px-6 py-3 hover:opacity-90"
        >
          Subscribe to Pro
        </Link>
        {!signedIn && (
          <Link
            to="/auth"
            className="ui small-caps text-xs border border-ink/40 px-6 py-3 hover:bg-ink hover:text-newsprint"
          >
            Sign in
          </Link>
        )}
        <Link to="/" className="ui small-caps text-xs underline text-muted-foreground">
          ← Back to Front Page
        </Link>
      </div>
    </div>
  );
}