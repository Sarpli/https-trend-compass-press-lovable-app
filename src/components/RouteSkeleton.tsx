export function RouteSkeleton() {
  return (
    <div
      className="route-skeleton mx-auto w-full max-w-5xl px-4 py-8 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-3 w-24 rounded bg-foreground/10 mb-4" />
      <div className="h-8 w-3/4 rounded bg-foreground/15 mb-3" />
      <div className="h-8 w-1/2 rounded bg-foreground/15 mb-6" />
      <div className="space-y-2 mb-8">
        <div className="h-3 w-full rounded bg-foreground/10" />
        <div className="h-3 w-11/12 rounded bg-foreground/10" />
        <div className="h-3 w-10/12 rounded bg-foreground/10" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border border-foreground/10 rounded p-4">
            <div className="h-32 w-full rounded bg-foreground/10 mb-3" />
            <div className="h-4 w-2/3 rounded bg-foreground/15 mb-2" />
            <div className="h-3 w-full rounded bg-foreground/10" />
          </div>
        ))}
      </div>
    </div>
  );
}