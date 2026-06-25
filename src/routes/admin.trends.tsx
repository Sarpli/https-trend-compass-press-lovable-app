import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { trendImage } from "@/lib/trend-image";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { validateImage, verdictLabel, verdictColor } from "@/lib/image-validation";
import { useServerFn } from "@tanstack/react-start";
import { importTrendImageFromUrl } from "@/lib/admin-image.functions";

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

  const flagged = (trends ?? []).filter((t) => {
    const v = validateImage(t.image_url, t).verdict;
    return v === "off-topic" || v === "maybe";
  }).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Editor's Desk</div>
      <h1 className="display text-4xl font-black mb-2">Trend image editor</h1>
      <p className="text-sm text-muted-foreground mb-2">Paste a URL to override the auto-pulled image, or clear it to fall back to the default.</p>
      <p className="text-xs ui small-caps text-accent-red mb-6">
        {flagged} of {trends?.length ?? 0} current images flagged as possibly off-topic.
      </p>

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
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFromUrl = useServerFn(importTrendImageFromUrl);
  const preview = value.trim() || trendImage(trend);
  // Score whatever is currently typed; fall back to saved value, then preview.
  const candidate = value.trim() || trend.image_url || preview;
  const validation = validateImage(candidate, trend);

  async function save(next: string | null) {
    if (next) {
      const v = validateImage(next, trend);
      if (v.verdict === "off-topic") {
        const ok = window.confirm(
          `This image scored ${v.score}/100 (likely off-topic for "${trend.term}").\n\n` +
          v.reasons.join("\n") +
          `\n\nSave anyway?`
        );
        if (!ok) return;
      }
    }
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

  async function importUrl() {
    const url = value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Enter a full http(s) URL");
      return;
    }
    const v = validateImage(url, trend);
    if (v.verdict === "off-topic") {
      const ok = window.confirm(
        `This image scored ${v.score}/100 (likely off-topic for "${trend.term}").\n\n` +
        v.reasons.join("\n") +
        `\n\nImport anyway?`
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      const { imageUrl } = await importFromUrl({
        data: { trendId: trend.id, slug: trend.slug, url },
      });
      setValue(imageUrl);
      toast.success("Image imported & re-hosted");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${trend.slug}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("trend-images")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setUploading(false);
      toast.error(upErr.message);
      return;
    }
    // 10-year signed URL so the private bucket is readable everywhere
    const { data: signed, error: signErr } = await supabase.storage
      .from("trend-images")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    setUploading(false);
    if (signErr || !signed?.signedUrl) {
      toast.error(signErr?.message ?? "Could not get image URL");
      return;
    }
    setValue(signed.signedUrl);
    await save(signed.signedUrl);
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] ui small-caps px-2 py-0.5 ${verdictColor(validation.verdict)}`}>
            {verdictLabel(validation.verdict)} · {validation.score}/100
          </span>
          <span className="text-[10px] text-muted-foreground leading-snug">
            {validation.reasons.join(" ")}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || saving}
          className="inline-flex items-center justify-center gap-2 bg-accent-red text-accent-foreground px-3 py-2 text-xs ui small-caps disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : "Upload image from your device"}
        </button>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="…or paste an image URL"
            className="flex-1 border border-ink/40 bg-background px-2 py-1 text-xs"
          />
          <button
            onClick={importUrl}
            disabled={importing || saving || !value.trim()}
            title="Download the image from this URL and re-host it in your bucket"
            className="bg-accent-red text-accent-foreground px-3 py-1 text-xs ui small-caps disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <button
            onClick={() => save(value.trim() || null)}
            disabled={saving || importing}
            title="Save the URL as-is (hot-link, not re-hosted)"
            className="bg-ink text-background px-3 py-1 text-xs ui small-caps disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save URL"}
          </button>
          {trend.image_url && (
            <button
              onClick={() => { setValue(""); save(null); }}
              disabled={saving || importing}
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