import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/glossary")({
  head: () => ({ meta: [{ title: "My Glossary — Trenslate" }] }),
  component: Glossary,
});

function Glossary() {
  const { user, isPro, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: items = [] } = useQuery({
    queryKey: ["glossary", user?.id],
    enabled: !!user && isPro,
    queryFn: async () => {
      const { data } = await supabase
        .from("saved_glossary")
        .select("trend_id, trends(slug,term,plain_language,category)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Pro · Personal Glossary</div>
      <h1 className="display text-5xl font-black mb-6">My Glossary</h1>

      {!isPro ? (
        <div className="bg-ink text-newsprint p-8">
          <h2 className="display text-2xl font-bold mb-2">Saving a glossary is a Pro feature.</h2>
          <p className="mb-4 text-newsprint/80">
            Upgrade to keep a personal field guide of every trend that matters to you.
          </p>
          <Link to="/pricing" className="ui small-caps text-xs underline">View plans →</Link>
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">No saved trends yet. Tap "Save to glossary" on any entry.</p>
      ) : (
        <ul className="grid md:grid-cols-2 gap-6">
          {items.map((row: any) => (
            <li key={row.trend_id} className="rule-top pt-3">
              <div className="ui small-caps text-[10px] text-accent-red">{row.trends?.category}</div>
              <Link to="/trends/$slug" params={{ slug: row.trends?.slug ?? "" }}>
                <h3 className="display text-2xl font-bold hover:text-accent-red">{row.trends?.term}</h3>
              </Link>
              <p className="text-sm mt-1 text-foreground/90 line-clamp-3">{row.trends?.plain_language}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}