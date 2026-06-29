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
  const RETRY_PENDING_KEY = "trenslate-chunk-retry-pending";
  let toastId: string | number | null = null;

  // Fetch the current page no-store so the browser/SW caches a fresh manifest
  // (new index.html → new <script src="/assets/...hash.js">), then hard-reload
  // so the new module graph actually executes. We keep the toast up until
  // either the retried navigation succeeds or it fails again — `success` is
  // implicit: the next page load tears down this script context, and the
  // pending flag is cleared on `load`. If the same chunk error fires again
  // post-reload, we re-show the toast with an escalated message.
  const runRetry = async (currentToastId: string | number | null) => {
    const target = window.location.href;
    try {
      sessionStorage.setItem(RETRY_PENDING_KEY, "1");
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {}

    if (currentToastId !== null) {
      toast.loading("Refreshing app…", {
        id: currentToastId,
        description: "Fetching the latest version.",
        duration: Infinity,
      });
    }

    // Bust HTTP + service-worker caches for the document so the reload sees
    // the new asset manifest, not the stale cached HTML.
    try {
      await fetch(target, { cache: "no-store", credentials: "same-origin" });
    } catch {
      // Network failure — surface it and leave the toast up so the user can retry.
      if (currentToastId !== null) {
        toast.error("Still offline", {
          id: currentToastId,
          description: "Check your connection and try again.",
          duration: Infinity,
          action: { label: "Retry", onClick: () => void runRetry(currentToastId) },
        });
      }
      return;
    }

    // Re-navigate to the same route with the fresh manifest. A hard reload is
    // required because the existing JS context still references the dead
    // chunk URLs from the old build.
    window.location.replace(target);
  };

  const showRetryToast = (escalated = false) => {
    if (toastId !== null) return;
    toastId = toast.error(
      escalated ? "Retry didn't work" : "This page couldn't load",
      {
        duration: Infinity,
        description: escalated
          ? "Still loading an old version of the app. Try again?"
          : "A newer version of the app is available. Reload to continue.",
        action: {
          label: escalated ? "Try again" : "Reload",
          onClick: () => void runRetry(toastId),
        },
      },
    );
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
      let escalated = false;
      try {
        escalated = !!sessionStorage.getItem(RETRY_PENDING_KEY);
        sessionStorage.removeItem(RETRY_PENDING_KEY);
      } catch {}
      showRetryToast(escalated);
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
      // The page successfully booted after the retry — clear the pending flag
      // so a future stale-chunk event starts from the non-escalated state.
      // We delay slightly to give route lazy-imports a moment to error out.
      setTimeout(() => {
        try { sessionStorage.removeItem(RETRY_PENDING_KEY); } catch {}
      }, 4000);
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
