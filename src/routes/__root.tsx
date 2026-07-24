import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { WelcomeAuthModal } from "../components/WelcomeAuthModal";
import { ScrollMemory } from "../lib/scroll-memory";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider } from "../lib/theme";
import { SettingsProvider } from "../lib/settings";
import { Toaster } from "../components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { recordPerf } from "@/lib/perf";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={async () => {
              try {
                reset();
                await router.invalidate();
              } catch {
                // ignore — fall through to a hard reload
              }
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Trendslated — The Daily Edition of Internet Culture" },
      { name: "description", content: "A newspaper-style field guide to slang, memes, and trends. Vote them up or down on a live cultural ticker." },
      { name: "author", content: "Trendslated" },
      { property: "og:title", content: "Trendslated — The Daily Edition of Internet Culture" },
      { property: "og:description", content: "A newspaper-style field guide to slang, memes, and trends. Vote them up or down on a live cultural ticker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Trendslated" },
      { name: "twitter:title", content: "Trendslated — The Daily Edition of Internet Culture" },
      { name: "twitter:description", content: "A newspaper-style field guide to slang, memes, and trends. Vote them up or down on a live cultural ticker." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/de97bef8-4908-42b7-b9a3-cf039c3fe924/id-preview-f2e9c4d5--fcedb4de-7e34-4e63-b291-8b8352a0117b.lovable.app-1783903668456.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/de97bef8-4908-42b7-b9a3-cf039c3fe924/id-preview-f2e9c4d5--fcedb4de-7e34-4e63-b291-8b8352a0117b.lovable.app-1783903668456.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800;900&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [introPlayed, setIntroPlayed] = useState(true);

  useEffect(() => {
    try {
      if (!window.sessionStorage.getItem("trendslated-intro-played")) {
        setIntroPlayed(false);
        window.sessionStorage.setItem("trendslated-intro-played", "1");
        const t = window.setTimeout(() => setIntroPlayed(true), 1600);
        return () => window.clearTimeout(t);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        queryClient.invalidateQueries();
      }
      if (event === "SIGNED_OUT") {
        queryClient.clear();
      }
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  // Test hook: when the URL includes `?stress=1`, expose the QueryClient on
  // window so the ticker stress test (tests/ticker_stress.py) can simulate
  // realtime vote bursts by invalidating the ticker query at high rate. The
  // hook is gated on the query string so production users never see it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("stress") === "1" || qs.get("qc") === "1") {
        (window as unknown as { __qc?: QueryClient }).__qc = queryClient;
      }
    } catch {}
  }, [queryClient]);

  // Render & long-task tracing. Reports any main-thread long tasks (>50ms)
  // and the first contentful paint per session as lightweight samples.
  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
    let lto: PerformanceObserver | null = null;
    let pto: PerformanceObserver | null = null;
    try {
      lto = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          recordPerf({ metric: "client.longtask", surface: "client", duration_ms: entry.duration });
        }
      });
      lto.observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      pto = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            recordPerf({ metric: "client.fcp", surface: "client", duration_ms: entry.startTime });
          }
        }
      });
      pto.observe({ type: "paint", buffered: true });
    } catch {}
    return () => {
      try { lto?.disconnect(); } catch {}
      try { pto?.disconnect(); } catch {}
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
        <SettingsProvider>
        <div className={`min-h-screen flex flex-col bg-background text-foreground${introPlayed ? "" : " intro-fluid-drop"}`}>
          <div className="liquid-ambient" aria-hidden="true">
            <div className="liquid-blob-3" />
          </div>
          <div className="relative z-10 flex flex-1 flex-col">
            <SiteHeader />
            <main className="flex-1">
              <RouteTransition />
            </main>
            <SiteFooter />
          </div>
        </div>
        <WelcomeAuthModal />
        <ScrollMemory />
        <Toaster />
        </SettingsProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RouteTransition() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="route-fluid-drop">
      <Outlet />
    </div>
  );
}
