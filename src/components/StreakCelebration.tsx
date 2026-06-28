import { useEffect, useState } from "react";

const PIECES = ["🔥", "✨", "🎉", "⭐", "💥", "🏆", "🎊"];

/**
 * Full-screen, one-shot celebration. Renders nothing once finished.
 * Mount with a unique `key` (e.g. an incrementing counter) to replay.
 */
export function StreakCelebration({
  streak,
  durationMs = 2200,
}: {
  streak: number;
  durationMs?: number;
}) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), durationMs);
    return () => window.clearTimeout(t);
  }, [durationMs]);

  if (done) return null;

  const pieces = Array.from({ length: 56 }, (_, i) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 350;
    const dur = 1400 + Math.random() * 900;
    const drift = (Math.random() * 120 - 60).toFixed(0);
    const rot = (Math.random() * 720 - 360).toFixed(0);
    const size = 18 + Math.random() * 22;
    return { i, left, delay, dur, drift, rot, size, e: PIECES[i % PIECES.length] };
  });

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
      aria-live="polite"
      aria-label={`Streak complete: ${streak} day${streak === 1 ? "" : "s"}`}
    >
      {/* Center banner */}
      <div
        className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ animation: "streak-pop 2200ms ease-out forwards" }}
      >
        <div className="text-6xl sm:text-7xl drop-shadow-lg">🔥</div>
        <div className="ui small-caps mt-2 text-xs tracking-[0.2em] text-accent-red">
          Streak Complete
        </div>
        <div className="font-serif text-4xl sm:text-5xl font-bold mt-1">
          {streak} day{streak === 1 ? "" : "s"}
        </div>
      </div>

      {pieces.map((p) => (
        <span
          key={p.i}
          className="absolute select-none"
          style={{
            left: `${p.left}%`,
            top: "-40px",
            fontSize: `${p.size}px`,
            animation: `streak-fall ${p.dur}ms ${p.delay}ms cubic-bezier(0.25, 0.8, 0.4, 1) forwards`,
            // @ts-expect-error CSS vars
            "--drift": `${p.drift}px`,
            "--rot": `${p.rot}deg`,
          }}
        >
          {p.e}
        </span>
      ))}

      <style>{`
        @keyframes streak-fall {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate(var(--drift), 110vh) rotate(var(--rot)); opacity: 0.85; }
        }
        @keyframes streak-pop {
          0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          18%  { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
          30%  { transform: translate(-50%, -50%) scale(1); }
          80%  { opacity: 1; }
          100% { transform: translate(-50%, -60%) scale(0.95); opacity: 0; }
        }
      `}</style>
    </div>
  );
}