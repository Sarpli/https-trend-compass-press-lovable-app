// On-topic validation for trend images.
// Pure client-side heuristic: scores a candidate image URL against the trend
// using source reputation + keyword/token overlap between the URL and the
// trend's term/slug/category. No network calls.

export type TrendLike = {
  term: string;
  slug: string;
  category?: string | null;
};

export type Verdict = "good" | "maybe" | "off-topic" | "empty";

export type ValidationResult = {
  score: number; // 0–100
  verdict: Verdict;
  reasons: string[]; // short human-readable bullets
};

// Known generic / junk image fingerprints we've seen polluting the dataset.
const BAD_FRAGMENTS = [
  "kym-logo",
  "wikipedia-logo",
  "gen_z_slang_conversation_on_snapchat",
  "placeholder",
  "default-image",
  "no-image",
  "source.unsplash.com", // dead fallback
];

const STOPWORDS = new Set([
  "the","a","an","of","and","or","to","in","on","for","with","is","it","this","that",
  "meme","slang","trend","aesthetic","header","cover","image","photo","jpg","jpeg",
  "png","webp","gif","svg","original","icons","entries","commons","wikipedia","upload",
  "wikimedia","thumb","screen","shot","screenshot","header1","cover1",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/%[0-9a-f]{2}/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function termTokens(trend: TrendLike): string[] {
  const raw = `${trend.term} ${trend.slug.replace(/-/g, " ")} ${trend.category ?? ""}`;
  const toks = new Set(tokenize(raw));
  // also keep the slug as a single token for tight matches like "girl-dinner" -> "girldinner"
  toks.add(trend.slug.replace(/-/g, ""));
  return [...toks].filter((t) => t.length >= 3);
}

export function validateImage(url: string | null | undefined, trend: TrendLike): ValidationResult {
  const clean = (url ?? "").trim();
  if (!clean) {
    return { score: 0, verdict: "empty", reasons: ["No image set — will use category fallback."] };
  }

  let host = "";
  let path = "";
  try {
    const u = new URL(clean);
    host = u.hostname.toLowerCase();
    path = decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    return { score: 5, verdict: "off-topic", reasons: ["URL is not valid."] };
  }

  const reasons: string[] = [];
  let score = 35; // neutral baseline

  // Source reputation
  if (host.includes("kym-cdn.com") || host.includes("knowyourmeme.com")) {
    score += 25;
    reasons.push("Source: Know Your Meme (canonical for memes).");
  } else if (host.includes("wikipedia") || host.includes("wikimedia")) {
    score += 10;
    reasons.push("Source: Wikipedia/Wikimedia (mixed relevance).");
  } else if (host.includes("supabase.co") || host.endsWith(".lovable.app")) {
    score += 20;
    reasons.push("Source: uploaded by editor.");
  } else if (host.includes("unsplash") || host.includes("pexels")) {
    score += 5;
    reasons.push("Source: stock photo — rarely on-topic for slang.");
  }

  // Generic junk penalties
  const lower = clean.toLowerCase();
  for (const frag of BAD_FRAGMENTS) {
    if (lower.includes(frag)) {
      score -= 45;
      reasons.push(`Looks generic (matches "${frag}").`);
    }
  }

  // Token overlap between URL path and trend identity
  const urlTokens = new Set(tokenize(path));
  const wanted = termTokens(trend);
  const hits = wanted.filter((t) => {
    for (const u of urlTokens) {
      if (u === t || u.includes(t) || t.includes(u)) return true;
    }
    return false;
  });

  if (hits.length > 0) {
    const bonus = Math.min(40, 15 + hits.length * 12);
    score += bonus;
    reasons.push(`URL mentions: ${hits.slice(0, 4).join(", ")}.`);
  } else if (host.includes("kym-cdn.com")) {
    // KYM URLs often use numeric IDs — don't punish, just note.
    reasons.push("No keyword match in URL (KYM IDs are numeric — verify visually).");
  } else {
    score -= 20;
    reasons.push("URL contains no words from this trend.");
  }

  // Clamp + verdict
  score = Math.max(0, Math.min(100, Math.round(score)));
  let verdict: Verdict;
  if (score >= 65) verdict = "good";
  else if (score >= 40) verdict = "maybe";
  else verdict = "off-topic";

  return { score, verdict, reasons };
}

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case "good": return "On-topic";
    case "maybe": return "Possibly off-topic";
    case "off-topic": return "Likely off-topic";
    case "empty": return "No image";
  }
}

export function verdictColor(v: Verdict): string {
  switch (v) {
    case "good": return "bg-emerald-600 text-white";
    case "maybe": return "bg-amber-500 text-black";
    case "off-topic": return "bg-accent-red text-accent-foreground";
    case "empty": return "bg-ink/20 text-ink";
  }
}