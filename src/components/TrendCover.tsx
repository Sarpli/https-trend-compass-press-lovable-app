import { cn } from "@/lib/utils";
import { TrendGlyph } from "@/components/TrendGlyph";

type Trend = {
  slug?: string | null;
  term?: string | null;
  category?: string | null;
  image_url?: string | null;
};

/**
 * Covers are procedural editorial graphics — no photography.
 * Kept as a wrapper so every call site (front page, archive, detail, admin)
 * renders the same deterministic mark at whatever aspect ratio it asks for.
 */
export function TrendCover({
  trend,
  className,
  variant = "diluted",
}: {
  trend: Trend;
  width?: number;
  height?: number;
  className?: string;
  sizes?: string;
  eager?: boolean;
  fetchpriority?: "high" | "low" | "auto";
  variant?: "diluted" | "cover";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden bg-muted/20",
        variant === "diluted" ? "opacity-95" : "",
        className,
      )}
    >
      <TrendGlyph trend={trend} />
    </div>
  );
}
