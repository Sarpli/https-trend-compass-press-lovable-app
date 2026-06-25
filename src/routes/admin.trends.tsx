import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { trendImage } from "@/lib/trend-image";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/trends")({
  head: () => ({ meta: [{ title: "Editor — Trenslate" }] }),
  component: AdminTrends,
});

function AdminTrends() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: isAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const { data: trends } = useQuery({
    queryKey: ["admin-trends"],
    enabled: !!isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trends")
        .select("id,slug,term,category,image_url")
        .order("term");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!user || loading || roleLoading) {
    return <div className="max-w-3xl mx-auto px-6 py-10 ui text-sm">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs ui small-caps text-accent-red mb-1">Restricted</div>
        <h1 className="display text-4xl font-black mb-3">Editors only</h1>
        <p className="text-sm">This desk is reserved for staff editors. Ask an admin to grant you the <code>admin</code> role.</p>
        <Link to="/" className="ui small-caps text-xs underline mt-4 inline-block">← Front page</Link>
      </div>
    );
  }

  const list = (trends ?? []).filter((t) =>
    !filter || t.term.toLowerCase().includes(filter.toLowerCase()) || t.slug.includes(filter.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Editor's Desk</div>
      <h1 className="display text-4xl font-black mb-2">Trend image editor</h1>
      <p className="text-sm text-muted-foreground mb-6">Paste a URL to override the auto-pulled image, or clear it to fall back to the default.</p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by term or slug…"
        className="w-full border border-ink/40 bg-background px-3 py-2 text-sm mb-6"
      />

      <div className="grid gap-4">
        {list.map((t) => (
          <Row key={t.id} trend={t} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-trends"] })} />
        ))}
        {list.length === 0 && <div className="text-sm text-muted-foreground">No trends match.</div>}
      </div>
    </div>
  );
}

type TrendRow = { id: string; slug: string; term: string; category: string | null; image_url: string | null };

function Row({ trend, onSaved }: { trend: TrendRow; onSaved: () => void }) {
  const [value, setValue] = useState(trend.image_url ?? "");
  const [saving, setSaving] = useState(false);
  const preview = value.trim() || trendImage(trend);

  async function save(next: string | null) {
    setSaving(true);
    const { error } = await supabase
      .from("trends")
      .update({ image_url: next })
      .eq("id", trend.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next ? "Image updated" : "Reset to default");
    onSaved();
  }

  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 border border-ink/20 p-3 bg-background">
      <img src={preview} alt={trend.term} className="w-[120px] h-[90px] object-cover border border-ink/20" />
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="display font-bold text-lg leading-tight">{trend.term}</div>
            <div className="text-[10px] ui small-caps text-muted-foreground">{trend.category ?? "uncategorized"} · {trend.slug}</div>
          </div>
          <Link to="/trends/$slug" params={{ slug: trend.slug }} className="text-[11px] ui small-caps underline">View</Link>
        </div>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://… image URL"
            className="flex-1 border border-ink/40 bg-background px-2 py-1 text-xs"
          />
          <button
            onClick={() => save(value.trim() || null)}
            disabled={saving}
            className="bg-ink text-background px-3 py-1 text-xs ui small-caps disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {trend.image_url && (
            <button
              onClick={() => { setValue(""); save(null); }}
              disabled={saving}
              className="border border-ink/40 px-3 py-1 text-xs ui small-caps disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}