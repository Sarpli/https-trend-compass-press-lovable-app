import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteSkeleton } from "./components/RouteSkeleton";

// Handle stale chunk imports after deploys: a fresh build invalidates old
// hashed JS chunks, so route lazy-imports fail with "Importing a module
// script failed." Reload once (guarded via sessionStorage) to pick up the
// new asset manifest instead of leaving the user on a blank page.
if (typeof window !== "undefined") {
  const RELOAD_KEY = "trenslate-chunk-reload";
  const isChunkError = (msg: unknown) => {
    const s = typeof msg === "string" ? msg : (msg as { message?: string })?.message ?? "";
    return (
      /Importing a module script failed/i.test(s) ||
      /Failed to fetch dynamically imported module/i.test(s) ||
      /error loading dynamically imported module/i.test(s) ||
      /ChunkLoadError/i.test(s)
    );
  };
  const maybeReload = (err: unknown) => {
    if (!isChunkError(err)) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {}
    window.location.reload();
  };
  window.addEventListener("error", (e) => maybeReload(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => maybeReload(e.reason));
  // Clear the guard on successful full load so future stale-chunk events still recover.
  window.addEventListener("load", () => {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
  });
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RouteSkeleton,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  });

  return router;
};
