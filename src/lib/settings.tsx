import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Motion = "auto" | "on" | "off";

export type Settings = {
  /** auto = follow OS prefers-reduced-motion, on = always reduce, off = always allow */
  reducedMotion: Motion;
  /** Multiplier applied to the top ticker scroll speed. 1 = default. */
  tickerSpeed: number;
  /** Whether streak pulse/confetti/bump animations play. */
  streakAnimations: boolean;
};

type Ctx = Settings & {
  setReducedMotion: (m: Motion) => void;
  setTickerSpeed: (n: number) => void;
  setStreakAnimations: (b: boolean) => void;
  /** Resolved boolean (auto -> media query). Safe to read in render. */
  motionReduced: boolean;
};

const KEY = "trendslated-settings-v1";
const DEFAULTS: Settings = {
  reducedMotion: "auto",
  tickerSpeed: 1,
  streakAnimations: true,
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [osReduced, setOsReduced] = useState(false);

  // Hydrate from storage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        setS((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  // Track OS preference
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setOsReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const motionReduced =
    s.reducedMotion === "on" || (s.reducedMotion === "auto" && osReduced);

  // Apply to <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("reduce-motion-app", motionReduced);
    root.style.setProperty("--ticker-speed-mul", String(s.tickerSpeed));
    root.classList.toggle("no-streak-anim", !s.streakAnimations || motionReduced);
  }, [motionReduced, s.tickerSpeed, s.streakAnimations]);

  // Persist
  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, [s]);

  const value: Ctx = {
    ...s,
    motionReduced,
    setReducedMotion: (reducedMotion) => setS((p) => ({ ...p, reducedMotion })),
    setTickerSpeed: (tickerSpeed) => setS((p) => ({ ...p, tickerSpeed })),
    setStreakAnimations: (streakAnimations) => setS((p) => ({ ...p, streakAnimations })),
  };

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}