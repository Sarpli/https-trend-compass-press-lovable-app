import { createFileRoute, Link } from "@tanstack/react-router";
import { useTheme } from "@/lib/theme";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Trenslate" },
      { name: "description", content: "App preferences for Trenslate." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { tickerSpeed, setTickerSpeed, streakAnimations, setStreakAnimations } = useSettings();

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Preferences</div>
      <h1 className="display text-4xl font-black mb-6">Settings</h1>

      <section aria-label="Preferences" className="grid gap-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="ui small-caps text-xs text-muted-foreground">Appearance</div>
            <div className="display text-lg font-bold">Theme</div>
          </div>
          <div className="inline-flex border border-ink/40 ui small-caps text-xs overflow-hidden">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={`px-3 py-1.5 transition-colors ${
                  theme === t ? "bg-ink text-newsprint" : "hover:bg-ink/10"
                }`}
              >
                {t === "light" ? "Morning" : "After hours"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="ui small-caps text-xs text-muted-foreground">Top ticker</div>
            <div className="display text-lg font-bold">Scroll speed</div>
            <div className="ui text-xs text-muted-foreground">
              {tickerSpeed === 0 ? "Paused" : `${tickerSpeed.toFixed(2)}× default`}
            </div>
          </div>
          <div className="flex items-center gap-3 min-w-[240px]">
            <input
              type="range"
              min={0}
              max={2}
              step={0.25}
              value={tickerSpeed}
              onChange={(e) => setTickerSpeed(Number(e.target.value))}
              aria-label="Ticker scroll speed"
              className="flex-1 accent-accent-red"
            />
            <button
              type="button"
              onClick={() => setTickerSpeed(1)}
              className="ui small-caps text-xs border border-ink/40 px-2 py-1 hover:bg-ink hover:text-newsprint"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="ui small-caps text-xs text-muted-foreground">Streaks</div>
            <div className="display text-lg font-bold">Streak animations</div>
            <div className="ui text-xs text-muted-foreground">
              Confetti and flame pulses when your streak grows.
            </div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <span className="ui small-caps text-xs">{streakAnimations ? "On" : "Off"}</span>
            <input
              type="checkbox"
              checked={streakAnimations}
              onChange={(e) => setStreakAnimations(e.target.checked)}
              className="h-4 w-4 accent-accent-red"
              aria-label="Streak animations"
            />
          </label>
        </div>
      </section>

      <div className="rule-top mt-10 pt-6">
        <Link
          to="/account"
          className="ui small-caps text-xs border border-ink/40 px-4 py-2 hover:bg-ink hover:text-newsprint"
        >
          Back to account
        </Link>
      </div>
    </div>
  );
}
