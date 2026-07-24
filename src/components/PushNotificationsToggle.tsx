import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function getPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

export function PushNotificationsToggle() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<PermissionState>("default");
  const [enabled, setEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(20);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPermission(getPermission());
  }, []);

  // Load + subscribe to realtime profile changes so prefs sync across devices.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("push_enabled, push_reminder_hour")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      setEnabled(Boolean(data.push_enabled));
      const h = Number(data.push_reminder_hour);
      if (Number.isFinite(h) && h >= 0 && h <= 23) setReminderHour(h);
    })();

    const channel = supabase
      .channel(`profile-push-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as { push_enabled?: boolean; push_reminder_hour?: number };
          if (typeof row.push_enabled === "boolean") setEnabled(row.push_enabled);
          const h = Number(row.push_reminder_hour);
          if (Number.isFinite(h) && h >= 0 && h <= 23) setReminderHour(h);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function persist(patch: { push_enabled?: boolean; push_reminder_hour?: number }) {
    if (!user) return;
    await supabase.from("profiles").update(patch).eq("id", user.id);
  }

  const supported = permission !== "unsupported";

  async function handleToggle(next: boolean) {
    if (!supported) return;
    setBusy(true);
    try {
      if (next) {
        let perm = Notification.permission;
        if (perm === "default") {
          perm = await Notification.requestPermission();
          setPermission(perm as PermissionState);
        }
        if (perm !== "granted") {
          setEnabled(false);
          await persist({ push_enabled: false });
          return;
        }
        setEnabled(true);
        await persist({ push_enabled: true });
        try {
          new Notification("Trendslated notifications on", {
            body: "We'll remind you to keep your streak alive.",
          });
        } catch {}
      } else {
        setEnabled(false);
        await persist({ push_enabled: false });
      }
    } finally {
      setBusy(false);
    }
  }

  function handleReminderChange(h: number) {
    setReminderHour(h);
    void persist({ push_reminder_hour: h });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="display text-lg font-bold">Push notifications</div>
          <div className="ui text-xs text-muted-foreground max-w-md">
            Daily streak reminders so you don't lose your run. Delivered through your device's notification center.
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <span className="ui small-caps text-xs">{enabled && permission === "granted" ? "On" : "Off"}</span>
          <input
            type="checkbox"
            checked={enabled && permission === "granted"}
            disabled={!supported || busy || permission === "denied"}
            onChange={(e) => handleToggle(e.target.checked)}
            className="h-4 w-4 accent-accent-red"
            aria-label="Enable push notifications"
          />
        </label>
      </div>

      {!supported && (
        <div className="ui text-xs text-muted-foreground border-l-2 border-ink/30 pl-3">
          Your browser doesn't support notifications. Install Trendslated to your home screen on iOS, or use Chrome/Safari on desktop.
        </div>
      )}
      {supported && permission === "denied" && (
        <div className="ui text-xs text-accent-red border-l-2 border-accent-red pl-3">
          Notifications are blocked. Enable them for this site in your browser settings, then refresh.
        </div>
      )}

      {enabled && permission === "granted" && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="ui small-caps text-xs text-muted-foreground">Reminder time</div>
            <div className="ui text-xs text-muted-foreground">
              Sent in your device's local timezone.
            </div>
          </div>
          <select
            value={reminderHour}
            onChange={(e) => handleReminderChange(Number(e.target.value))}
            className="ui text-xs border border-ink/40 bg-transparent px-2 py-1.5"
            aria-label="Reminder hour"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {((h + 11) % 12) + 1}:00 {h < 12 ? "AM" : "PM"}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}