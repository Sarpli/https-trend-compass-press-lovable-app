// WSJ-style loading skeleton: newsprint dateline, double rule, serif headline
// placeholder, drop-cap column, and a sidebar — visually consistent with the
// real article layout so transitions don't feel broken.
export function RouteSkeleton() {
  return (
    <div
      className="route-skeleton mx-auto w-full max-w-5xl px-4 py-8"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <span className="sr-only">Loading page…</span>

      {/* Dateline / kicker */}
      <div className="flex items-center justify-between mb-2 animate-pulse">
        <div className="h-2.5 w-32 rounded-sm bg-foreground/15" />
        <div className="h-2.5 w-20 rounded-sm bg-foreground/10" />
      </div>

      {/* WSJ double rule */}
      <div className="border-t-2 border-b border-double border-foreground/30 mb-5 h-1.5" />

      {/* Headline stack */}
      <div className="animate-pulse mb-3 space-y-3">
        <div className="h-9 md:h-12 w-11/12 rounded-sm bg-foreground/20" />
        <div className="h-9 md:h-12 w-3/4 rounded-sm bg-foreground/20" />
      </div>

      {/* Deck / subhead */}
      <div className="animate-pulse mb-6 space-y-2">
        <div className="h-3.5 w-2/3 rounded-sm bg-foreground/12" />
        <div className="h-3.5 w-1/2 rounded-sm bg-foreground/12" />
      </div>

      {/* Byline */}
      <div className="flex items-center gap-3 mb-6 animate-pulse">
        <div className="h-2.5 w-24 rounded-sm bg-foreground/15" />
        <div className="h-px flex-1 bg-foreground/15" />
        <div className="h-2.5 w-16 rounded-sm bg-foreground/10" />
      </div>

      {/* Body + sidebar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 animate-pulse">
          {/* Drop cap */}
          <div className="flex gap-3 mb-3">
            <div className="h-14 w-14 shrink-0 rounded-sm bg-foreground/25" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-full rounded-sm bg-foreground/10" />
              <div className="h-3 w-11/12 rounded-sm bg-foreground/10" />
              <div className="h-3 w-10/12 rounded-sm bg-foreground/10" />
            </div>
          </div>
          <div className="space-y-2 mb-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-3 rounded-sm bg-foreground/10"
                style={{ width: `${92 - (i % 3) * 6}%` }}
              />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-3 rounded-sm bg-foreground/10"
                style={{ width: `${88 - (i % 4) * 5}%` }}
              />
            ))}
          </div>
        </div>

        <aside className="md:col-span-1 animate-pulse border-t-2 border-b border-double border-foreground/30 pt-3 pb-4">
          <div className="h-2.5 w-20 rounded-sm bg-foreground/20 mb-3" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-4 w-5/6 rounded-sm bg-foreground/18" />
                <div className="h-2.5 w-2/3 rounded-sm bg-foreground/10" />
                {i < 3 && <div className="h-px w-full bg-foreground/15 mt-2" />}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}