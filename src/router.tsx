import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteSkeleton } from "./components/RouteSkeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Best-effort deploy fingerprint: the hashed filename of a loaded asset chunk
// uniquely identifies the build the user has in their tab.
const getBuildVersion = (): string => {
  if (typeof document === "undefined") return "ssr";
  const meta = document.querySelector('meta[name="build-version"]') as HTMLMetaElement | null;
  if (meta?.content) return meta.content;
  const script = document.querySelector(
    'script[src*="/assets/"][src*="-"]'
  ) as HTMLScriptElement | null;
  if (script?.src) {
    const m = script.src.match(/([^/]+\.[cm]?js)(?:\?.*)?$/);
    if (m) return m[1];
  }
  return "unknown";
};

// Handle stale chunk imports after deploys: a fresh build invalidates old
// hashed JS chunks, so route lazy-imports fail with "Importing a module
// script failed." Reload once (guarded via sessionStorage) to pick up the
// new asset manifest instead of leaving the user on a blank page.
if (typeof window !== "undefined") {
  const RELOAD_KEY = "trenslate-chunk-reload";
  const REPORT_KEY = "trenslate-chunk-reported";
  const isChunkError = (msg: unknown) => {
    const s = typeof msg === "string" ? msg : (msg as { message?: string })?.message ?? "";
    return (
      /Importing a module script failed/i.test(s) ||
      /Failed to fetch dynamically imported module/i.test(s) ||
      /error loading dynamically imported module/i.test(s) ||
      /ChunkLoadError/i.test(s)
    );
  };
  const reportChunkError = (err: unknown) => {
    try {
      if (sessionStorage.getItem(REPORT_KEY)) return;
      sessionStorage.setItem(REPORT_KEY, "1");
    } catch {}
    const message =
      typeof err === "string"
        ? err
        : (err as { message?: string })?.message ?? String(err);
    const sourceUrl =
      (err as { filename?: string })?.filename ??
      (err as { request?: string })?.request ??
      null;
    void supabase.from("chunk_errors").insert({
      build_version: getBuildVersion(),
      message: message?.slice(0, 1000) ?? null,
      source_url: sourceUrl,
      page_url: typeof location !== "undefined" ? location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    }).then(() => {}, () => {});
  };
  let toastShown = false;
  const showRetryToast = () => {
    if (toastShown) return;
    toastShown = true;
    toast.error("This page couldn't load", {
      description:
        "A newer version of the app is available. Reload to continue.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => {
          try {
            sessionStorage.removeItem(RELOAD_KEY);
          } catch {}
          window.location.reload();
        },
      },
    });
  };
  const maybeReload = (err: unknown) => {
    if (!isChunkError(err)) return;
    reportChunkError(err);
    let alreadyReloaded = false;
    try {
      alreadyReloaded = !!sessionStorage.getItem(RELOAD_KEY);
      if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {}
    if (alreadyReloaded) {
      // Auto-reload already happened this session and we still hit a chunk
      // error — surface a toast so the user isn't staring at a blank page.
      showRetryToast();
      return;
    }
    window.location.reload();
  };
  window.addEventListener("error", (e) => maybeReload(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => maybeReload(e.reason));
  // Clear the guard on successful full load so future stale-chunk events still recover.
  window.addEventListener("load", () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
      sessionStorage.removeItem(REPORT_KEY);
    } catch {}
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
