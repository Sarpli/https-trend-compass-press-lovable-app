import { trendImage } from "@/lib/trend-image";
import { cn } from "@/lib/utils";
import itGirlManifest from "@/assets/it-girl-responsive.json";

type Trend = {
  slug?: string | null;
  term?: string | null;
  category?: string | null;
  image_url?: string | null;
};

type Manifest = { avif: Record<string, string>; webp: Record<string, string>; jpg: Record<string, string> };

// Registry of slugs that have pre-generated responsive variants.
const RESPONSIVE: Record<string, Manifest> = {
  "it-girl": itGirlManifest as Manifest,
};

function srcset(map: Record<string, string>) {
  return Object.entries(map)
    .map(([w, url]) => `${url} ${w}w`)
    .join(", ");
}

export function TrendCover({
  trend,
  width,
  height,
  className,
  sizes = "(min-width: 1024px) 800px, (min-width: 640px) 600px, 100vw",
  eager = false,
  fetchpriority,
  variant = "diluted",
}: {
  trend: Trend;
  width: number;
  height: number;
  className?: string;
  sizes?: string;
  eager?: boolean;
  fetchpriority?: "high" | "low" | "auto";
  variant?: "diluted" | "cover";
}) {
  const slug = trend.slug ?? "";
  const manifest = RESPONSIVE[slug];
  const alt = trend.term ?? "";
  const loading = eager ? "eager" : "lazy";
  const decoding = eager ? "sync" : "async";
  const base =
    variant === "diluted"
      ? "object-contain object-center bg-muted/40 opacity-90 grayscale-[20%]"
      : "object-cover grayscale-[20%]";
  const imageClassName = cn(base, className);

  if (!manifest) {
    return (
      <img
        src={trendImage(trend, width, height)}
        alt={alt}
        loading={loading}
        decoding={decoding}
        // @ts-expect-error - fetchpriority is a valid attribute, types lag
        fetchpriority={fetchpriority}
        className={imageClassName}
      />
    );
  }

  const widths = Object.keys(manifest.jpg).map(Number).sort((a, b) => a - b);
  const fallbackW = widths[widths.length - 1].toString();
  return (
    <picture>
      <source type="image/avif" srcSet={srcset(manifest.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcset(manifest.webp)} sizes={sizes} />
      <img
        src={manifest.jpg[fallbackW]}
        srcSet={srcset(manifest.jpg)}
        sizes={sizes}
        alt={alt}
        loading={loading}
        decoding={decoding}
        // @ts-expect-error - fetchpriority is a valid attribute, types lag
        fetchpriority={fetchpriority}
        className={imageClassName}
        width={width}
        height={height}
      />
    </picture>
  );
}
