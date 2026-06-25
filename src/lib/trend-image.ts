// Returns a usable hero image URL for a trend.
// If the row has an explicit image_url, use it. Otherwise fall back to
// an Unsplash keyword search based on category + term (deterministic per slug).
export function trendImage(
  t: { image_url?: string | null; category?: string | null; term?: string | null; slug?: string | null },
  w = 600,
  h = 400,
): string {
  if (t.image_url) return t.image_url;
  const kw = [t.category, t.term].filter(Boolean).join(",") || "culture";
  const sig = (t.slug || t.term || "x").length;
  return `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(kw)}&sig=${sig}`;
}