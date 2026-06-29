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

const fingerprint = (parts: Array<string | null | undefined>): string => {
  const s = parts.filter(Boolean).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `fp_${(h >>> 0).toString(36)}`;
};

export const isChunkError = (msg: unknown): boolean => {
  const s = typeof msg === "string" ? msg : (msg as { message?: string })?.message ?? "";
  return (
    /Importing a module script failed/i.test(s) ||
    /Failed to fetch dynamically imported module/i.test(s) ||
    /error loading dynamically imported module/i.test(s) ||
    /ChunkLoadError/i.test(s)
  );
};

const RELOAD_KEY = "trenslate-chunk-reload";
const REPORT_PREFIX = "trenslate-chunk-reported:";
const RETRY_PENDING_KEY = "trenslate-chunk-retry-pending";
const REPORT_TTL_MS = 10 * 60 * 1000;
const MAX_REPORTS_PER_SESSION = 5;

export const installChunkRetry = () => {
  if (typeof window === "undefined") return;
  let reportsThisSession = 0;
  let toastId: string | number | null = null;
  // Exponential backoff for repeated "Try again" clicks. Reset whenever a
  // fresh retry toast is shown (new error cycle) or after a successful fetch.
  // Delay sequence: 0, 1s, 2s, 4s, 8s, 16s, capped at BACKOFF_MAX_MS.
  const BACKOFF_BASE_MS = 1000;
  const BACKOFF_MAX_MS = 30_000;
  let retryAttempt = 0;
  let pendingBackoff: ReturnType<typeof setTimeout> | null = null;
  // Context the "Report this issue" button submits with the report.
  let lastErrorMessage: string | null = null;
  let lastErrorSourceUrl: string | null = null;
  let lastToastState: "initial" | "escalated" | "loading" | "offline" | null = null;
  const nextBackoffMs = (attempt: number) =>
    attempt <= 0 ? 0 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));

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
    lastErrorMessage = message ?? null;
    lastErrorSourceUrl = sourceUrl;
    const buildVersion = getBuildVersion();
    const fp = fingerprint([message, sourceUrl, buildVersion]);
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

  const runRetry = async (currentToastId: string | number | null) => {
    const target = window.location.href;
    try {
      sessionStorage.setItem(RETRY_PENDING_KEY, "1");
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {}

    const delayMs = nextBackoffMs(retryAttempt);
    if (currentToastId !== null) {
      lastToastState = "loading";
      toast.loading("Refreshing app…", {
        id: currentToastId,
        description:
          delayMs > 0
            ? `Waiting ${Math.round(delayMs / 1000)}s before retrying…`
            : "Fetching the latest version.",
        duration: Infinity,
        cancel: {
          label: "Report issue",
          onClick: () => void submitReport(currentToastId),
        },
      });
    }

    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        pendingBackoff = setTimeout(() => {
          pendingBackoff = null;
          resolve();
        }, delayMs);
      });
    }

    try {
      await fetch(target, { cache: "no-store", credentials: "same-origin" });
    } catch {
      retryAttempt = Math.min(retryAttempt + 1, 16);
      if (currentToastId !== null) {
        const nextMs = nextBackoffMs(retryAttempt);
        lastToastState = "offline";
        toast.error("Still offline", {
          id: currentToastId,
          description:
            nextMs > 0
              ? `Check your connection. Next retry waits ${Math.round(nextMs / 1000)}s.`
              : "Check your connection and try again.",
          duration: Infinity,
          action: { label: "Retry", onClick: () => void runRetry(currentToastId) },
          cancel: {
            label: "Report issue",
            onClick: () => void submitReport(currentToastId),
          },
        });
      }
      return;
    }

    // Manifest fetch succeeded — reset backoff so a future cycle starts fresh.
    retryAttempt = 0;
    window.location.replace(target);
  };

  const showRetryToast = (escalated = false) => {
    if (toastId !== null) return;
    // Fresh error cycle: reset backoff state and clear any pending timer.
    retryAttempt = 0;
    if (pendingBackoff !== null) {
      clearTimeout(pendingBackoff);
      pendingBackoff = null;
    }
    lastToastState = escalated ? "escalated" : "initial";
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
        cancel: {
          label: "Report issue",
          onClick: () => void submitReport(toastId),
        },
      },
    );
  };

  const submitReport = async (currentToastId: string | number | null) => {
    const payload = {
      client_id: getClientId(),
      route: typeof location !== "undefined" ? location.pathname : null,
      page_url: typeof location !== "undefined" ? location.href : null,
      message: lastErrorMessage?.slice(0, 1000) ?? null,
      source_url: lastErrorSourceUrl,
      build_version: getBuildVersion(),
      retry_attempt: retryAttempt,
      last_toast_state: lastToastState,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
    };
    try {
      const { error } = await supabase.from("chunk_error_reports").insert(payload);
      if (error) throw error;
      if (currentToastId !== null) {
        toast.success("Report sent — thank you", {
          id: currentToastId,
          description: "Our team will investigate. You can keep retrying meanwhile.",
          duration: 6000,
          action: { label: "Retry", onClick: () => void runRetry(currentToastId) },
        });
      }
    } catch {
      if (currentToastId !== null) {
        toast.error("Couldn't send report", {
          id: currentToastId,
          description: "Check your connection and try again.",
          duration: Infinity,
          action: { label: "Try report", onClick: () => void submitReport(currentToastId) },
          cancel: { label: "Retry page", onClick: () => void runRetry(currentToastId) },
        });
      }
    }
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
  window.addEventListener("load", () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
      setTimeout(() => {
        try { sessionStorage.removeItem(RETRY_PENDING_KEY); } catch {}
      }, 4000);
    } catch {}
  });

  // Exposed for integration tests; harmless in prod (no callers).
  return { runRetry, showRetryToast, maybeReload, submitReport };
};
