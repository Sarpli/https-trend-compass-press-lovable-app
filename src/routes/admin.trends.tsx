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
import { todayLocalISO, deviceTimezone } from "@/lib/timezone";

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
        .select("id,slug,term,category,image_url,safety_tips")
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

      <SpotlightPin trends={trends ?? []} />

      <StreakOverride />

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

type TrendRow = { id: string; slug: string; term: string; category: string | null; image_url: string | null; safety_tips: string };

function StreakOverride() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayLocalISO();

  const { data: profile } = useQuery({
    queryKey: ["admin-self-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("streak_count, max_streak, last_active_local_date, last_active_date")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [streak, setStreak] = useState<string>("");
  const [maxStreak, setMaxStreak] = useState<string>("");
  const [lastDate, setLastDate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setStreak(String(profile.streak_count ?? 0));
    setMaxStreak(String(profile.max_streak ?? 0));
    setLastDate(profile.last_active_local_date ?? profile.last_active_date ?? today);
  }, [profile, today]);

  async function save() {
    if (!user) return;
    const s = Math.max(0, Math.floor(Number(streak) || 0));
    const m = Math.max(s, Math.max(0, Math.floor(Number(maxStreak) || 0)));
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        streak_count: s,
        max_streak: m,
        last_active_local_date: lastDate || today,
        last_active_date: lastDate || today,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Streak updated");
    qc.invalidateQueries({ queryKey: ["admin-self-profile", user.id] });
    qc.invalidateQueries({ queryKey: ["profile-streak"] });
    qc.invalidateQueries({ queryKey: ["effective-streak"] });
    qc.invalidateQueries({ queryKey: ["streak-history"] });
  }

  async function markToday() {
    setLastDate(today);
  }

  return (
    <section className="border border-ink/40 bg-background p-4 mb-6">
      <div className="text-[10px] ui small-caps text-accent-red mb-1">Streak override</div>
      <h2 className="display text-2xl font-black mb-1">Edit your streak</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Owner-only adjustment of your own streak. Local date is in {deviceTimezone()}.
      </p>
      <div className="grid sm:grid-cols-[1fr_1fr_1.2fr_auto] gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] ui small-caps text-muted-foreground">Current streak</span>
          <input
            type="number"
            min={0}
            value={streak}
            onChange={(e) => setStreak(e.target.value)}
            className="border border-ink/40 bg-background px-2 py-1 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] ui small-caps text-muted-foreground">All-time best</span>
          <input
            type="number"
            min={0}
            value={maxStreak}
            onChange={(e) => setMaxStreak(e.target.value)}
            className="border border-ink/40 bg-background px-2 py-1 text-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] ui small-caps text-muted-foreground">Last active (local)</span>
          <div className="flex gap-2">
            <input
              type="date"
              value={lastDate}
              onChange={(e) => setLastDate(e.target.value)}
              className="flex-1 border border-ink/40 bg-background px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={markToday}
              className="border border-ink/40 px-2 py-1 text-[10px] ui small-caps"
            >
              Today
            </button>
          </div>
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="bg-accent-red text-accent-foreground px-4 py-2 text-xs ui small-caps disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save streak"}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Tip: set last active to yesterday and the streak will tick up by one the next time you mark a term as learned.
      </p>
    </section>
  );
}

function SpotlightPin({ trends }: { trends: TrendRow[] }) {
  const qc = useQueryClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: pin } = useQuery({
    queryKey: ["spotlight-pin", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("spotlight_pins")
        .select("pin_date, trend_id, trends:trend_id(term, slug)")
        .eq("pin_date", today)
        .maybeSingle();
      return data;
    },
  });

  const { data: upcoming = [] } = useQuery({
    queryKey: ["spotlight-pins-upcoming", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("spotlight_pins")
        .select("pin_date, trend_id, trends:trend_id(term, slug)")
        .gt("pin_date", today)
        .order("pin_date");
      return data ?? [];
    },
  });

  const [pickDate, setPickDate] = useState(today);
  const [pickTrend, setPickTrend] = useState("");
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const options = trends
    .filter((t) => !filter || t.term.toLowerCase().includes(filter.toLowerCase()) || t.slug.includes(filter.toLowerCase()))
    .slice(0, 50);

  async function savePin() {
    if (!pickTrend) {
      toast.error("Pick a trend first");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("spotlight_pins")
      .upsert({ pin_date: pickDate, trend_id: pickTrend }, { onConflict: "pin_date" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Spotlight pinned for ${pickDate}`);
    setPickTrend("");
    setFilter("");
    qc.invalidateQueries({ queryKey: ["spotlight-pin", today] });
    qc.invalidateQueries({ queryKey: ["spotlight-pins-upcoming", today] });
  }

  async function clearPin(date: string) {
    const { error } = await supabase.from("spotlight_pins").delete().eq("pin_date", date);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Pin cleared for ${date}`);
    qc.invalidateQueries({ queryKey: ["spotlight-pin", today] });
    qc.invalidateQueries({ queryKey: ["spotlight-pins-upcoming", today] });
  }

  return (
    <section className="border border-ink/40 bg-background p-4 mb-6">
      <div className="text-[10px] ui small-caps text-accent-red mb-1">Spotlight Override</div>
      <h2 className="display text-2xl font-black mb-1">Pin today's trend spotlight</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Pins are keyed by date and auto-release at local midnight the next day.
      </p>

      <div className="text-xs mb-3">
        <span className="ui small-caps text-muted-foreground">Today ({today}): </span>
        {pin?.trends ? (
          <>
            <span className="font-bold">{pin.trends.term}</span>{" "}
            <button onClick={() => clearPin(today)} className="underline ml-2">clear</button>
          </>
        ) : (
          <span className="text-muted-foreground">no pin — using popular-pool rotation</span>
        )}
      </div>

      <div className="grid sm:grid-cols-[160px_1fr_auto] gap-2 items-start">
        <input
          type="date"
          value={pickDate}
          min={today}
          onChange={(e) => setPickDate(e.target.value)}
          className="border border-ink/40 bg-background px-2 py-1 text-xs"
        />
        <div className="flex flex-col gap-1">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter trends…"
            className="border border-ink/40 bg-background px-2 py-1 text-xs"
          />
          <select
            value={pickTrend}
            onChange={(e) => setPickTrend(e.target.value)}
            className="border border-ink/40 bg-background px-2 py-1 text-xs"
          >
            <option value="">— select a trend —</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>{t.term} ({t.slug})</option>
            ))}
          </select>
        </div>
        <button
          onClick={savePin}
          disabled={saving}
          className="bg-accent-red text-accent-foreground px-4 py-2 text-xs ui small-caps disabled:opacity-50"
        >
          {saving ? "Saving…" : "Pin spotlight"}
        </button>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] ui small-caps text-muted-foreground mb-1">Upcoming pins</div>
          <ul className="text-xs space-y-1">
            {upcoming.map((u) => (
              <li key={u.pin_date} className="flex items-center gap-2">
                <span className="tabular-nums">{u.pin_date}</span>
                <span>·</span>
                <span className="font-bold">{u.trends?.term ?? u.trend_id}</span>
                <button onClick={() => clearPin(u.pin_date)} className="underline ml-2">clear</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

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