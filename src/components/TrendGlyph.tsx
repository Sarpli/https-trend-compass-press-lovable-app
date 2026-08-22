import { cn } from "@/lib/utils";
import { symbolForTrend } from "@/components/TrendSymbol";

/**
 * Procedural, deterministic editorial glyph for a trend.
 * No photography: every cover is a simple geometric graphic built from the
 * design tokens (ink on newsprint with an oxblood accent), seeded by slug so
 * a given term always renders the same mark.
 */

type Trend = {
  slug?: string | null;
  term?: string | null;
  category?: string | null;
};

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(term: string) {
  const words = term.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const INK = "var(--ink)";
const RED = "var(--accent-red)";

export function TrendGlyph({
  trend,
  className,
  showLabel = true,
}: {
  trend: Trend;
  className?: string;
  showLabel?: boolean;
}) {
  const seedKey = trend.slug || trend.term || "trend";
  const seed = hash(seedKey);
  const mono = initials(trend.term ?? seedKey);
  const dotId = `halftone-${seed.toString(36)}`;
  const Symbol = symbolForTrend(trend);

  return (
    <svg
      viewBox="0 0 160 90"
      role="img"
      aria-label={trend.term ? `${trend.term} — illustrative mark` : "Trend mark"}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block w-full h-full", className)}
    >
      <defs>
        <pattern id={dotId} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill={INK} opacity="0.16" />
        </pattern>
      </defs>
      <rect width="160" height="90" fill="var(--newsprint)" />
      <rect width="160" height="90" fill={`url(#${dotId})`} />
      <rect x="3" y="3" width="154" height="84" fill="none" stroke={INK} strokeWidth="0.8" opacity="0.35" />
      <Symbol />

      {showLabel && (
        <>
          <rect x="10" y="76" width="140" height="0.8" fill={INK} opacity="0.3" />
          <text
            x="10"
            y="84"
            fill={INK}
            opacity="0.7"
            style={{ font: "600 6px var(--font-ui, ui-sans-serif)", letterSpacing: "1.2px" }}
          >
            {(trend.category ?? "trend").toUpperCase()}
          </text>
          <text
            x="150"
            y="84"
            textAnchor="end"
            fill={RED}
            style={{ font: "700 7px var(--font-display, ui-serif)", letterSpacing: "0.5px" }}
          >
            {mono}
          </text>
        </>
      )}
    </svg>
  );
}
