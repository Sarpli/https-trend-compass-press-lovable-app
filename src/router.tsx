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

// Stable per-browser id so dedup also works for signed-out users.
const getClientId = (): string => {
  try {
    const KEY = "trenslate-client-id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
        `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
};

// Cheap stable fingerprint for an error (no crypto needed).
const fingerprint = (parts: Array<string | null | undefined>): string => {
  const s = parts.filter(Boolean).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `fp_${(h >>> 0).toString(36)}`;
};

// Handle stale chunk imports after deploys: a fresh build invalidates old
// hashed JS chunks, so route lazy-imports fail with "Importing a module
// script failed." Reload once (guarded via sessionStorage) to pick up the
// new asset manifest instead of leaving the user on a blank page.
if (typeof window !== "undefined") {
  const RELOAD_KEY = "trenslate-chunk-reload";
  const REPORT_PREFIX = "trenslate-chunk-reported:";
  // Client-side throttle: don't re-send the same fingerprint within 10 min,
  // mirroring the server-side dedup window so retries never reach the table.
  const REPORT_TTL_MS = 10 * 60 * 1000;
  const MAX_REPORTS_PER_SESSION = 5;
  let reportsThisSession = 0;
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
    if (reportsThisSession >= MAX_REPORTS_PER_SESSION) return;
    const message =
      typeof err === "string"
        ? err
        : (err as { message?: string })?.message ?? String(err);
    const sourceUrl =
      (err as { filename?: string })?.filename ??
      (err as { request?: string })?.request ??
      null;
    const buildVersion = getBuildVersion();
    const fp = fingerprint([message, sourceUrl, buildVersion]);
    // Local cooldown keyed by fingerprint — survives reloads.
    try {
      const key = REPORT_PREFIX + fp;
      const last = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - last < REPORT_TTL_MS) return;
      localStorage.setItem(key, String(Date.now()));
    } catch {}
    reportsThisSession++;
    void supabase
      .from("chunk_errors")
      .insert({
        build_version: buildVersion,
        message: message?.slice(0, 1000) ?? null,
        source_url: sourceUrl,
        page_url: typeof location !== "undefined" ? location.href : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        fingerprint: fp,
        client_id: getClientId(),
      })
      .then(() => {}, () => {});
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
