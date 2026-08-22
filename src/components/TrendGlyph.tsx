import { cn } from "@/lib/utils";

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

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function initials(term: string) {
  const words = term.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const INK = "var(--ink)";
const RED = "var(--accent-red)";

function Motif({ kind, rand }: { kind: number; rand: () => number }) {
  // Drawn inside a 0 0 160 90 viewBox.
  switch (kind) {
    case 0: {
      // Concentric rings, one accented.
      const accent = 1 + Math.floor(rand() * 3);
      return (
        <g>
          {[34, 27, 20, 13, 6].map((r, i) => (
            <circle
              key={r}
              cx={80}
              cy={45}
              r={r}
              fill="none"
              stroke={i === accent ? RED : INK}
              strokeWidth={i === accent ? 2.6 : 1.4}
              opacity={i === accent ? 1 : 0.75}
            />
          ))}
        </g>
      );
    }
    case 1: {
      // Ascending bar chart.
      const bars = 7;
      const heights = Array.from({ length: bars }, (_, i) => 10 + i * 6 + rand() * 8);
      const peak = heights.indexOf(Math.max(...heights));
      return (
        <g>
          {heights.map((h, i) => (
            <rect
              key={i}
              x={26 + i * 15}
              y={72 - h}
              width={9}
              height={h}
              fill={i === peak ? RED : INK}
              opacity={i === peak ? 1 : 0.72}
            />
          ))}
        </g>
      );
    }
    case 2: {
      // Zigzag line with a marker.
      const pts = Array.from({ length: 8 }, (_, i) => `${20 + i * 17},${26 + rand() * 36}`);
      const mid = pts[Math.floor(pts.length / 2)].split(",");
      return (
        <g>
          <polyline points={pts.join(" ")} fill="none" stroke={INK} strokeWidth={2.2} />
          <circle cx={Number(mid[0])} cy={Number(mid[1])} r={4.5} fill={RED} />
        </g>
      );
    }
    case 3: {
      // Starburst rays.
      const rays = 14;
      return (
        <g>
          {Array.from({ length: rays }, (_, i) => {
            const a = (i / rays) * Math.PI * 2;
            const inner = 9;
            const outer = 24 + rand() * 14;
            return (
              <line
                key={i}
                x1={80 + Math.cos(a) * inner}
                y1={45 + Math.sin(a) * inner}
                x2={80 + Math.cos(a) * outer}
                y2={45 + Math.sin(a) * outer}
                stroke={i % 5 === 0 ? RED : INK}
                strokeWidth={i % 5 === 0 ? 2.4 : 1.3}
                opacity={0.85}
              />
            );
          })}
          <circle cx={80} cy={45} r={5} fill={INK} />
        </g>
      );
    }
    case 4: {
      // Dot matrix with an accented cluster.
      const cols = 11;
      const rows = 6;
      const ax = Math.floor(rand() * cols);
      const ay = Math.floor(rand() * rows);
      return (
        <g>
          {Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const on = Math.abs(c - ax) <= 1 && Math.abs(r - ay) <= 1;
              return (
                <circle
                  key={`${r}-${c}`}
                  cx={26 + c * 11}
                  cy={18 + r * 11}
                  r={on ? 3.4 : 2}
                  fill={on ? RED : INK}
                  opacity={on ? 1 : 0.55}
                />
              );
            }),
          )}
        </g>
      );
    }
    case 5: {
      // Stacked triangles.
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const w = 46 - i * 12;
            const y = 70 - i * 18;
            return (
              <polygon
                key={i}
                points={`${80 - w / 2},${y} ${80 + w / 2},${y} 80,${y - 20}`}
                fill={i === 1 ? RED : INK}
                opacity={i === 1 ? 1 : 0.7}
              />
            );
          })}
        </g>
      );
    }
    case 6: {
      // Nested arcs.
      return (
        <g fill="none" strokeLinecap="round">
          {[16, 25, 34].map((r, i) => (
            <path
              key={r}
              d={`M ${80 - r} 62 A ${r} ${r} 0 0 1 ${80 + r} 62`}
              stroke={i === 2 ? RED : INK}
              strokeWidth={i === 2 ? 2.8 : 1.6}
              opacity={i === 2 ? 1 : 0.8}
            />
          ))}
          <rect x={40} y={62} width={80} height={1.6} fill={INK} opacity={0.6} />
        </g>
      );
    }
    default: {
      // Split diagonal blocks.
      const flip = rand() > 0.5;
      return (
        <g>
          <polygon points={flip ? "34,16 118,16 34,74" : "34,16 118,16 118,74"} fill={INK} opacity={0.85} />
          <polygon points={flip ? "118,74 118,16 40,74" : "34,74 34,20 112,74"} fill={RED} opacity={0.9} />
        </g>
      );
    }
  }
}

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
  const rand = rng(seed);
  const kind = seed % 8;
  const mono = initials(trend.term ?? seedKey);
  const dotId = `halftone-${seed.toString(36)}`;

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
      <Motif kind={kind} rand={rand} />
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
