/**
 * Cross-platform haptic feedback for vote interactions.
 *
 * - Android / desktop Chrome: real `navigator.vibrate` pulses.
 * - iOS Safari: no Vibration API support, so we synthesize a very short
 *   low-frequency WebAudio "thump" that the phone's speaker reproduces as
 *   a tactile-feeling click. Kept brief (<60ms) and quiet so it reads as
 *   feedback, not as a sound effect.
 */
type Kind = "up" | "down" | "tap";

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function thump(freq: number, durationMs: number, gain = 0.08) {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), now + durationMs / 1000);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(g).connect(ac.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function haptic(kind: Kind = "tap") {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  const pattern = kind === "up" ? [12, 18, 12] : kind === "down" ? 28 : 14;
  // Android / Chrome — real haptic pulse.
  if (typeof nav.vibrate === "function") {
    try { nav.vibrate(pattern); } catch {}
  }
  // iOS fallback — short sub-bass thump felt through the speaker grill.
  // Different timbres for up vs down so they feel distinct.
  if (kind === "up") thump(180, 45, 0.07);
  else if (kind === "down") thump(90, 55, 0.09);
  else thump(140, 35, 0.06);
}

/**
 * Celebratory ascending chime + longer haptic pattern for big moments
 * (e.g. completing today's streak for the first time).
 */
export function celebrate() {
  if (typeof navigator !== "undefined") {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate === "function") {
      try { nav.vibrate([18, 40, 18, 40, 30]); } catch {}
    }
  }
  const ac = getCtx();
  if (!ac) return;
  // Major triad arpeggio: C5 → E5 → G5 → C6
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const now = ac.currentTime;
  notes.forEach((freq, i) => {
    const t = now + i * 0.09;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}