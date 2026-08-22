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
  const Symbol = symbolForTrend(trend);
  const rays = 16;
  const rot = seed % 22;

  return (
    <svg
      viewBox="0 0 160 90"
      role="img"
      aria-label={trend.term ? `${trend.term} — illustrative mark` : "Trend mark"}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block w-full h-full", className)}
    >
      <rect width="160" height="90" fill="var(--newsprint)" />

      {/* comic-book action burst behind the mark */}
      <g transform={`rotate(${rot} 80 42)`} opacity="0.13">
        {Array.from({ length: rays }, (_, i) => {
          const a = (i / rays) * Math.PI * 2;
          const a2 = a + Math.PI / rays / 1.6;
          const r = 120;
          return (
            <path
              key={i}
              d={`M80 42 L${80 + Math.cos(a) * r} ${42 + Math.sin(a) * r} L${80 + Math.cos(a2) * r} ${42 + Math.sin(a2) * r} Z`}
              fill={i % 2 === 0 ? INK : RED}
            />
          );
        })}
      </g>

      {/* bold comic panel frame with offset drop-shadow */}
      <rect x="6" y="6" width="150" height="80" fill={INK} opacity="0.22" />
      <rect x="3" y="3" width="150" height="80" fill="none" stroke={INK} strokeWidth="2.6" />

      <g transform="translate(78 30) scale(0.84) translate(-80 -42)">
        <Symbol />
      </g>

      {showLabel && (
        <>
          <rect x="3" y="70" width="150" height="13" fill={INK} opacity="0.9" />
          <text
            x="9"
            y="79"
            fill="var(--newsprint)"
            style={{ font: "800 6px var(--font-ui, ui-sans-serif)", letterSpacing: "1.4px" }}
          >
            {(trend.category ?? "trend").toUpperCase()}
          </text>
          <text
            x="147"
            y="79"
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
