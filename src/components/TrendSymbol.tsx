/**
 * Meaning-driven editorial icons.
 *
 * Every symbol is hand-drawn geometry inside a 160x90 viewBox, centred around
 * (80, 40), leaving the bottom strip free for the category/monogram label.
 * `symbolForTrend` maps a trend (researched by slug/term/meaning) to the icon
 * that actually depicts it, instead of a random abstract mark.
 */

const INK = "var(--ink)";
const RED = "var(--accent-red)";

import type { ReactElement } from "react";

type P = { children?: never };

const S = {
  ink: { stroke: INK, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
  red: { stroke: RED, strokeWidth: 2.6, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
};

function Text({ children, size = 26, y = 50, x = 80, color = INK }: { children: string; size?: number; y?: number; x?: number; color?: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={color}
      style={{ font: `800 ${size}px var(--font-display, ui-serif)`, letterSpacing: "0.5px" }}
    >
      {children}
    </text>
  );
}

/* ---------------------------------- icons --------------------------------- */

const ArrowUp = () => (
  <g>
    <path d="M80 62 V22" {...S.red} />
    <path d="M66 34 L80 20 L94 34" {...S.red} />
    <path d="M56 68 H104" {...S.ink} />
  </g>
);

const Levels = ({ up = true }: { up?: boolean } = {}) => (
  <g>
    {[0, 1, 2].map((i) => (
      <path key={i} d={`M58 ${26 + i * 14} H102`} stroke={i === (up ? 0 : 2) ? RED : INK} strokeWidth={i === (up ? 0 : 2) ? 3.2 : 1.6} strokeLinecap="round" />
    ))}
    <path d={up ? "M80 66 V54 M74 60 L80 54 L86 60" : "M80 20 V32 M74 26 L80 32 L86 26"} {...S.red} />
  </g>
);

const Flame = () => (
  <g>
    <path d="M80 18 C92 32 98 38 98 48 a18 18 0 0 1-36 0 c0-8 8-14 12-22 2 8 6 10 6 16 0-6 0-14 0-20z" {...S.red} />
    <path d="M62 70 H98" {...S.ink} />
  </g>
);

const Crown = () => (
  <g>
    <path d="M52 60 L58 26 L70 44 L80 22 L90 44 L102 26 L108 60 Z" {...S.ink} />
    <circle cx={80} cy={22} r={3.4} fill={RED} />
    <path d="M52 68 H108" {...S.red} />
  </g>
);

const Eye = () => (
  <g>
    <path d="M46 42 C58 24 102 24 114 42 C102 60 58 60 46 42 Z" {...S.ink} />
    <circle cx={86} cy={42} r={8} fill={RED} />
    <circle cx={86} cy={42} r={2.4} fill="var(--newsprint)" />
  </g>
);

const CapIcon = () => (
  <g>
    <path d="M54 46 a26 20 0 0 1 52 0 Z" {...S.ink} />
    <path d="M106 46 H124" {...S.red} />
    <path d="M50 46 H110" {...S.ink} />
    <path d="M56 62 L104 24" {...S.red} />
  </g>
);

const BrainRot = () => (
  <g>
    <path d="M60 30 a14 14 0 0 1 22-6 a14 14 0 0 1 20 12 a12 12 0 0 1-4 20 H64 a12 12 0 0 1-4-26 Z" {...S.ink} />
    <path d="M68 58 v10 M80 58 v14 M92 58 v9" {...S.red} />
  </g>
);

const Bow = () => (
  <g>
    <path d="M80 42 L52 26 v32 Z" {...S.ink} />
    <path d="M80 42 L108 26 v32 Z" {...S.ink} />
    <circle cx={80} cy={42} r={5} fill={RED} />
    <path d="M76 50 L68 70 M84 50 L92 70" {...S.ink} />
  </g>
);

const Cup = () => (
  <g>
    <path d="M56 28 H100 v16 a22 22 0 0 1-44 0 Z" {...S.ink} />
    <path d="M100 32 a10 10 0 0 1 0 16" {...S.ink} />
    <path d="M52 70 H104" {...S.red} />
    <path d="M68 22 c4-6 0-8 4-12 M82 22 c4-6 0-8 4-12" {...S.red} />
  </g>
);

const Heart = ({ split = false }: { split?: boolean } = {}) => (
  <g>
    <path d="M80 64 C58 48 52 40 52 32 a14 14 0 0 1 28-4 a14 14 0 0 1 28 4 c0 8-6 16-28 32 Z" {...S.ink} />
    {split && <path d="M80 18 V68" stroke={RED} strokeWidth={2.6} strokeDasharray="5 5" />}
    {!split && <circle cx={80} cy={38} r={5} fill={RED} />}
  </g>
);

const Flag = () => (
  <g>
    <path d="M60 18 V72" {...S.ink} />
    <path d="M60 22 H106 v22 H60 Z" fill={RED} opacity={0.9} />
  </g>
);

const Money = () => (
  <g>
    <rect x={46} y={26} width={68} height={34} {...S.ink} />
    <circle cx={80} cy={43} r={9} {...S.red} />
    <path d="M80 32 v22" {...S.red} />
  </g>
);

const Robot = () => (
  <g>
    <rect x={54} y={26} width={52} height={36} rx={4} {...S.ink} />
    <circle cx={68} cy={42} r={4} fill={INK} />
    <circle cx={92} cy={42} r={4} fill={RED} />
    <path d="M80 26 V16 M70 54 H90" {...S.ink} />
    <circle cx={80} cy={14} r={3} fill={RED} />
  </g>
);

const Toilet = () => (
  <g>
    <path d="M56 30 H98 v14 a16 16 0 0 1-16 16 h-8 a18 18 0 0 1-18-18 Z" {...S.ink} />
    <path d="M70 60 v10 H92" {...S.ink} />
    <circle cx={78} cy={40} r={6} fill={RED} />
  </g>
);

const Speech = ({ dots = 3 }: { dots?: number } = {}) => (
  <g>
    <path d="M46 22 H114 v34 H74 L60 68 V56 H46 Z" {...S.ink} />
    {Array.from({ length: dots }, (_, i) => (
      <circle key={i} cx={66 + i * 14} cy={39} r={3.6} fill={i === 1 ? RED : INK} />
    ))}
  </g>
);

const SplitFace = () => (
  <g>
    <rect x={48} y={20} width={32} height={44} fill={INK} opacity={0.85} />
    <rect x={80} y={20} width={32} height={44} fill={RED} opacity={0.9} />
    <path d="M80 16 V70" stroke="var(--newsprint)" strokeWidth={2.4} />
  </g>
);

const Racket = () => (
  <g>
    <ellipse cx={74} cy={32} rx={18} ry={22} {...S.ink} />
    <path d="M62 22 L86 44 M86 22 L62 44" stroke={INK} strokeWidth={1} />
    <path d="M80 54 L98 72" {...S.ink} />
    <circle cx={104} cy={30} r={5} fill={RED} />
  </g>
);

const Fruit = ({ kind = "tomato" }: { kind?: "tomato" | "strawberry" } = {}) => (
  <g>
    {kind === "tomato" ? (
      <>
        <circle cx={80} cy={46} r={20} fill={RED} opacity={0.9} />
        <path d="M80 26 l-8-8 M80 26 l8-8 M80 26 v-10" {...S.ink} />
      </>
    ) : (
      <>
        <path d="M60 34 C70 62 90 62 100 34 C92 26 68 26 60 34 Z" fill={RED} opacity={0.9} />
        <path d="M68 30 h24 M80 24 v8" {...S.ink} />
        <circle cx={74} cy={42} r={1.6} fill="var(--newsprint)" />
        <circle cx={86} cy={44} r={1.6} fill="var(--newsprint)" />
        <circle cx={80} cy={52} r={1.6} fill="var(--newsprint)" />
      </>
    )}
  </g>
);

const Plate = () => (
  <g>
    <circle cx={80} cy={42} r={22} {...S.ink} />
    <circle cx={80} cy={42} r={13} stroke={INK} strokeWidth={1} fill="none" />
    <path d="M48 28 v28 M112 28 v28" {...S.ink} />
    <circle cx={80} cy={42} r={5} fill={RED} />
  </g>
);

const Shake = () => (
  <g>
    <path d="M62 30 H98 L92 70 H68 Z" {...S.ink} />
    <path d="M62 40 H98" {...S.ink} />
    <path d="M84 30 L92 14" {...S.red} />
    <circle cx={94} cy={12} r={3.4} fill={RED} />
  </g>
);

const Hippo = () => (
  <g>
    <ellipse cx={78} cy={46} rx={26} ry={17} {...S.ink} />
    <circle cx={60} cy={30} r={7} {...S.ink} />
    <circle cx={96} cy={30} r={7} {...S.ink} />
    <circle cx={68} cy={44} r={2.6} fill={INK} />
    <ellipse cx={96} cy={50} rx={9} ry={7} fill={RED} opacity={0.9} />
  </g>
);

const Goggles = () => (
  <g>
    <circle cx={64} cy={42} r={14} {...S.ink} />
    <circle cx={96} cy={42} r={14} {...S.ink} />
    <path d="M78 42 H82 M40 42 H50 M110 42 H120" {...S.ink} />
    <circle cx={64} cy={42} r={5} fill={RED} />
    <circle cx={96} cy={42} r={5} fill={INK} />
  </g>
);

const Door = () => (
  <g>
    <rect x={58} y={18} width={38} height={52} {...S.ink} />
    <circle cx={88} cy={44} r={2.6} fill={INK} />
    <path d="M100 44 H120 M112 36 L120 44 L112 52" {...S.red} />
  </g>
);

const Scissors = () => (
  <g>
    <path d="M52 22 L92 56 M92 22 L52 56" {...S.ink} />
    <circle cx={98} cy={62} r={7} {...S.red} />
    <circle cx={46} cy={62} r={7} {...S.red} />
    <path d="M100 26 H118" {...S.ink} />
  </g>
);

const Jaw = () => (
  <g>
    <path d="M56 20 v22 c0 16 10 26 24 28 14-2 24-12 24-28 V20" {...S.ink} />
    <path d="M62 46 c8 12 28 12 36 0" {...S.red} />
  </g>
);

const Leaf = () => (
  <g>
    <path d="M80 70 C56 58 56 30 80 16 C104 30 104 58 80 70 Z" {...S.ink} />
    <path d="M80 66 V22" {...S.red} />
    <path d="M80 40 l-12-8 M80 50 l12-8" {...S.ink} />
  </g>
);

const Pump = () => (
  <g>
    <rect x={58} y={22} width={34} height={48} {...S.ink} />
    <rect x={64} y={28} width={22} height={14} fill={RED} opacity={0.9} />
    <path d="M92 34 h12 v26" {...S.ink} />
    <Text size={11} y={62} x={75}>
      85
    </Text>
  </g>
);

const Box = () => (
  <g>
    <rect x={54} y={28} width={52} height={38} {...S.ink} />
    <path d="M54 40 H106" {...S.ink} />
    <path d="M74 28 v12 M86 28 v12" {...S.ink} />
    <path d="M62 52 H98" {...S.red} />
  </g>
);

const Letter = ({ ch }: { ch: string }) => (
  <g>
    <rect x={56} y={18} width={48} height={48} {...S.ink} />
    <Text size={30} y={54} color={RED}>
      {ch}
    </Text>
  </g>
);

const Question = () => (
  <g>
    <circle cx={80} cy={40} r={26} {...S.ink} />
    <path d="M70 30 a10 10 0 0 1 20 2 c0 7-10 7-10 14" {...S.red} />
    <circle cx={80} cy={54} r={3} fill={RED} />
  </g>
);

const TrollFace = () => (
  <g>
    <circle cx={80} cy={40} r={26} {...S.ink} />
    <path d="M62 48 c10 12 26 12 36 0" {...S.red} />
    <path d="M68 32 h10 M84 32 h10" {...S.ink} />
    <circle cx={73} cy={36} r={2} fill={INK} />
    <circle cx={89} cy={36} r={2} fill={INK} />
  </g>
);

const Jester = () => (
  <g>
    <path d="M54 58 C54 30 106 30 106 58 Z" {...S.ink} />
    <path d="M54 58 c-8-6-10-18-4-24 6 4 8 12 4 24" {...S.red} />
    <path d="M106 58 c8-6 10-18 4-24-6 4-8 12-4 24" {...S.red} />
    <circle cx={80} cy={26} r={4} fill={RED} />
  </g>
);

const Column = () => (
  <g>
    <path d="M50 26 H110 M54 66 H106" {...S.ink} />
    {[60, 74, 88].map((x) => (
      <path key={x} d={`M${x} 30 V62`} stroke={INK} strokeWidth={3} />
    ))}
    <path d="M102 30 V62" stroke={RED} strokeWidth={3} />
  </g>
);

const Bolt = () => (
  <g>
    <path d="M86 14 L60 46 H78 L72 72 L100 38 H82 Z" fill={RED} opacity={0.92} />
    <path d="M46 70 H114" {...S.ink} />
  </g>
);

const Star = () => (
  <g>
    <path d="M80 16 L88 38 L112 38 L92 51 L99 72 L80 58 L61 72 L68 51 L48 38 L72 38 Z" fill={RED} opacity={0.92} />
    <path d="M44 24 h6 M110 24 h6" {...S.ink} />
  </g>
);

const Mirror = () => (
  <g>
    <rect x={50} y={20} width={26} height={46} {...S.ink} />
    <rect x={84} y={20} width={26} height={46} stroke={RED} strokeWidth={2.4} fill="none" strokeDasharray="6 4" />
    <path d="M80 14 V72" stroke={INK} strokeWidth={1} />
  </g>
);

const Hourglass = () => (
  <g>
    <path d="M58 18 H102 L80 42 L102 66 H58 L80 42 Z" {...S.ink} />
    <path d="M58 18 H102 M58 66 H102" {...S.ink} />
    <path d="M80 42 v18" {...S.red} />
  </g>
);

const Grid = () => (
  <g>
    {[0, 1, 2, 3].map((r) =>
      [0, 1, 2, 3].map((c) => (
        <rect
          key={`${r}-${c}`}
          x={54 + c * 14}
          y={16 + r * 14}
          width={10}
          height={10}
          fill={r === c ? RED : INK}
          opacity={r === c ? 1 : 0.4}
        />
      )),
    )}
  </g>
);

const Droplet = () => (
  <g>
    <path d="M80 14 C94 34 100 42 100 50 a20 20 0 0 1-40 0 c0-8 6-16 20-36 Z" {...S.ink} />
    <circle cx={74} cy={50} r={5} fill={RED} />
  </g>
);

const Spiral = () => (
  <g>
    <path d="M80 42 a6 6 0 1 1 6 6 a12 12 0 1 1-14-12 a20 20 0 1 1 22 24 a28 28 0 1 1-32-34" {...S.red} />
    <circle cx={80} cy={42} r={2.6} fill={INK} />
  </g>
);

const Squiggle = () => (
  <g>
    <path d="M44 44 q10-18 20 0 t20 0 t20 0 t12 0" {...S.red} />
    <path d="M44 62 H116" {...S.ink} />
  </g>
);

const Sign = () => (
  <g>
    <rect x={44} y={20} width={72} height={36} {...S.ink} />
    <path d="M52 32 H108 M52 40 H96 M52 48 H86" stroke={INK} strokeWidth={1.6} opacity={0.6} />
    <path d="M60 62 L100 62" {...S.red} />
    <path d="M44 20 L116 56" {...S.red} />
  </g>
);

const Hoop = () => (
  <g>
    <circle cx={66} cy={44} r={16} {...S.ink} />
    <circle cx={96} cy={44} r={16} stroke={RED} strokeWidth={2.6} fill="none" />
  </g>
);

const Block = () => (
  <g>
    <rect x={44} y={20} width={72} height={40} fill={RED} opacity={0.9} />
    <Text size={22} y={48} color="var(--newsprint)">
      ▮▮▮
    </Text>
  </g>
);

const Cart = () => (
  <g>
    <path d="M46 24 H58 L68 56 H104 L112 32 H62" {...S.ink} />
    <circle cx={74} cy={66} r={5} fill={RED} />
    <circle cx={100} cy={66} r={5} fill={RED} />
  </g>
);

const Explosion = () => (
  <g>
    <path d="M80 12 L88 30 L108 22 L100 40 L120 46 L100 52 L108 70 L88 60 L80 76 L72 60 L52 70 L60 52 L40 46 L60 40 L52 22 L72 30 Z" fill={RED} opacity={0.9} />
    <circle cx={80} cy={44} r={7} fill="var(--newsprint)" />
  </g>
);

const Baby = () => (
  <g>
    <circle cx={80} cy={34} r={16} {...S.ink} />
    <circle cx={74} cy={32} r={2} fill={INK} />
    <circle cx={86} cy={32} r={2} fill={INK} />
    <path d="M74 40 c4 4 8 4 12 0" {...S.red} />
    <path d="M58 68 c6-12 38-12 44 0" {...S.ink} />
  </g>
);

const Target = () => (
  <g>
    {[24, 16, 8].map((r, i) => (
      <circle key={r} cx={80} cy={42} r={r} stroke={i === 2 ? RED : INK} strokeWidth={i === 2 ? 3 : 1.8} fill="none" />
    ))}
    <path d="M80 10 V22 M80 62 V74 M48 42 H60 M100 42 H112" {...S.ink} />
  </g>
);

const Note = () => (
  <g>
    <path d="M66 62 V22 l30-6 v10 l-30 6" {...S.ink} />
    <circle cx={60} cy={62} r={7} fill={RED} />
    <circle cx={94} cy={54} r={7} fill={INK} opacity={0.8} />
  </g>
);

const Mic = () => (
  <g>
    <rect x={70} y={14} width={20} height={30} rx={10} {...S.ink} />
    <path d="M60 38 a20 20 0 0 0 40 0" {...S.red} />
    <path d="M80 58 v12 M66 70 H94" {...S.ink} />
  </g>
);

const Calendar = () => (
  <g>
    <rect x={50} y={20} width={60} height={46} {...S.ink} />
    <path d="M50 32 H110" {...S.ink} />
    <rect x={86} y={44} width={14} height={14} fill={RED} />
    <path d="M62 14 v10 M98 14 v10" {...S.ink} />
  </g>
);

const Lips = () => (
  <g>
    <path d="M48 42 C60 26 74 36 80 36 c6 0 20-10 32 6 -12 18-40 22-64 0 Z" fill={RED} opacity={0.9} />
    <path d="M48 42 H112" stroke={INK} strokeWidth={1.2} />
  </g>
);

const Sparkle = () => (
  <g>
    <path d="M80 14 L86 36 L108 42 L86 48 L80 70 L74 48 L52 42 L74 36 Z" fill={RED} opacity={0.9} />
    <path d="M110 20 l4 8 8 4 -8 4 -4 8 -4-8 -8-4 8-4 Z" fill={INK} opacity={0.7} />
  </g>
);

const Pointer = () => (
  <g>
    <path d="M52 30 H96" {...S.ink} />
    <path d="M84 20 L98 30 L84 40" {...S.red} />
    <path d="M52 56 H108" {...S.ink} />
    <circle cx={64} cy={56} r={5} fill={RED} />
  </g>
);

const RedDot = () => (
  <g>
    <circle cx={80} cy={42} r={24} fill={RED} opacity={0.92} />
    <circle cx={80} cy={42} r={31} stroke={INK} strokeWidth={1.6} fill="none" />
  </g>
);

const Slice = () => (
  <g>
    <path d="M46 62 L80 20 L114 62 Z" {...S.ink} />
    <path d="M60 46 H100" {...S.red} />
    <circle cx={80} cy={54} r={3.4} fill={RED} />
  </g>
);

const Lock = () => (
  <g>
    <rect x={58} y={38} width={44} height={30} rx={3} {...S.ink} />
    <path d="M68 38 v-8 a12 12 0 0 1 24 0 v8" {...S.ink} />
    <circle cx={80} cy={52} r={5} fill={RED} />
  </g>
);

const Elephant = () => (
  <g>
    <ellipse cx={74} cy={44} rx={22} ry={16} {...S.ink} />
    <circle cx={98} cy={38} r={12} {...S.ink} />
    <path d="M104 46 c8 8 4 20-4 22" {...S.red} />
    <path d="M62 60 v10 M84 60 v10" {...S.ink} />
    <path d="M60 34 c-8-4-14 2-10 10" {...S.ink} />
  </g>
);

const Moon = () => (
  <g>
    <path d="M92 16 a26 26 0 1 0 0 52 a20 20 0 0 1 0-52 Z" {...S.ink} />
    <circle cx={108} cy={26} r={3} fill={RED} />
    <circle cx={116} cy={40} r={2} fill={INK} />
  </g>
);

const Numbers = ({ label }: { label: string }) => (
  <g>
    <rect x={34} y={18} width={92} height={44} {...S.ink} />
    <Text size={label.length > 4 ? 18 : 26} y={50} color={RED}>
      {label}
    </Text>
  </g>
);

/* --------------------------------- mapping -------------------------------- */

type Sym = () => ReactElement;

const MAP: Record<string, Sym> = {
  // numbers & catchphrase memes
  "41": () => <Numbers label="41" />,
  "six-seven": () => <Numbers label="6-7" />,
  "9-10-21": () => <Numbers label="9+10" />,
  "e85": Pump,
  "la-pos": Note,

  // maxxing / mogging / status
  maxxing: ArrowUp,
  looksmaxxing: Mirror,
  jestermaxxing: Jester,
  mog: ArrowUp,
  "frame-mogging": ArrowUp,
  "asu-frame-mog": ArrowUp,
  "o-moggle": ArrowUp,
  mewing: Jaw,
  gigachad: Crown,
  sigma: Crown,
  "main-character": Crown,
  "it-girl": Crown,
  aura: Sparkle,
  rizz: Sparkle,
  rizzler: Sparkle,
  glaze: Droplet,
  "lock-in": Lock,
  "let-him-cook": Plate,
  "transcending-the-game-drake": Bolt,
  "speed-face": Bolt,
  "thats-my-man-method": Pointer,

  // eyes / judgement / vibes
  "side-eye-chloe": Eye,
  "vibe-check": Eye,
  "pattern-recognition": Grid,
  "chat-is-this-real": Speech,
  "who-is-coco": Question,
  "who-is-he": Question,
  "adrian-christian-hernandez": Question,
  ick: Squiggle,
  cringe: Squiggle,
  cheugy: Sign,
  mid: Mirror,
  dupe: Mirror,
  delulu: Spiral,
  edging: Hourglass,
  highkey: () => <Levels up />,
  lowkey: () => <Levels up={false} />,

  // truth / lies / talk
  cap: CapIcon,
  "cap-no-cap": CapIcon,
  bet: () => <Speech dots={2} />,
  fairs: () => <Speech dots={2} />,
  yap: () => <Speech dots={3} />,
  pluh: () => <Speech dots={1} />,
  son: () => <Speech dots={1} />,
  unc: () => <Speech dots={2} />,
  "du-bist-gut-genug": Heart,
  "i-got-a-text": Speech,
  "boyfriend-im-nervous": Speech,
  "biggie-carmel-skice": Slice,
  "w-in-the-chat": () => <Letter ch="W" />,
  "i-wish-i-had-a-free-bag-of-chips": Plate,
  ate: Star,
  slay: Star,
  based: Star,
  era: Star,
  bop: Note,
  folk: Note,
  gyat: Levels,

  // brainrot / AI
  "brain-rot": BrainRot,
  "italian-brainrot": BrainRot,
  "ai-slop": Robot,
  goyslop: Plate,
  "corbin-gpt": Robot,
  "ai-fruit-love-island": Robot,
  npc: Robot,
  "npc-streamer": Robot,
  skibidi: Toilet,
  "skibidi-toilet": Toilet,
  "ballerina-cappuccina": Cup,
  "tralalero-tralala": Note,
  "tung-tung-sahur": Note,
  "troll-face": TrollFace,
  "strawberry-elephant": Elephant,
  "moo-deng": Hippo,
  "moo-deng-baby": Hippo,
  gentleminions: Goggles,
  "grimace-shake": Shake,
  "chill-guy": Moon,
  "the-biggest-beefsteak": Slice,
  "costco-guys": Cart,
  "nyc-is-going-to-blow-up": Explosion,
  "im-a-mommy-love-island": Baby,
  "hawk-tuah": Droplet,
  "blue-gold-dress": SplitFace,
  "yanny-laurel": SplitFace,

  // aesthetics
  balletcore: Bow,
  coquette: Bow,
  blokette: Bow,
  brat: Block,
  "clean-girl": Hoop,
  tenniscore: Racket,
  "tomato-girl": () => <Fruit kind="tomato" />,
  "mob-wife": Lips,
  "mob-wife-winter": Lips,
  tradwife: Plate,
  demure: Bow,
  "demure-mindful": Bow,
  "very-mindful-very-demure": Bow,
  "low-taper-fade": Scissors,
  "chopped-chin": Scissors,
  chopped: Scissors,
  "big-red": RedDot,
  "flight-reacts": Mic,
  "zias-and-blou": Mic,
  "full-box": Box,
  ohio: () => <Letter ch="OH" />,
  "roman-empire": Column,
  "irish-exit": Door,
  opp: Target,
  ragebait: Flame,
  crashout: Flame,
  fein: Flame,
  goon: Moon,
  zaza: Leaf,
  munchin: Plate,
  bussin: Plate,
  "girl-dinner": Plate,
  "girl-math": Money,
  "boy-math": Money,
  "loud-budgeting": Money,
  "quiet-quitting": Money,
  "fanum-tax": Money,
  "beige-flag": Flag,
  "green-flag": Flag,
  situationship: () => <Heart split />,
  "hard-launch": Heart,
  "soft-launch": () => <Heart split />,
  "canon-event": Calendar,
  cooked: Flame,
};

export function symbolForTrend(trend: { slug?: string | null; term?: string | null; category?: string | null }) {
  const slug = (trend.slug ?? "").toLowerCase();
  const hit = MAP[slug];
  if (hit) return hit;

  // keyword fallbacks derived from the term itself
  const t = `${trend.term ?? ""} ${trend.category ?? ""}`.toLowerCase();
  const rules: [RegExp, Sym][] = [
    [/maxx|mog/, ArrowUp],
    [/girl|core|wife|aesthetic/, Bow],
    [/math|budget|tax|money/, Money],
    [/flag/, Flag],
    [/heart|launch|situation|dating/, Heart],
    [/brain|slop|ai\b/, BrainRot],
    [/music|song|bop/, Note],
    [/food|dinner|eat/, Plate],
    [/meme/, TrollFace],
    [/slang|catchphrase/, Speech],
  ];
  for (const [re, comp] of rules) if (re.test(t)) return comp;
  return Star;
}

export type { P };
