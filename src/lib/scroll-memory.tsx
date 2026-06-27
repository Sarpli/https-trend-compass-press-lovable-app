import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Persist window scrollY per full URL in sessionStorage so the Back
 * button restores the exact section the user left from — even when the
 * destination route's content streams in asynchronously after pop.
 */
export function ScrollMemory() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const KEY = "trenslate-scroll-memory";
    const read = (): Record<string, number> => {
      try {
        return JSON.parse(window.sessionStorage.getItem(KEY) || "{}");
      } catch {
        return {};
      }
    };
    const write = (m: Record<string, number>) => {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify(m));
      } catch {}
    };

    let currentHref = window.location.href;
    let rafId = 0;
    const persist = () => {
      const m = read();
      m[currentHref] = window.scrollY;
      write(m);
    };
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        persist();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const restore = (target: number) => {
      let tries = 0;
      const maxTries = 40; // ~640ms at 16ms/frame
      const tick = () => {
        const maxY = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        const y = Math.min(target, maxY);
        window.scrollTo(0, y);
        if (++tries < maxTries && Math.abs(window.scrollY - target) > 4 && maxY < target) {
          requestAnimationFrame(tick);
        } else if (++tries < maxTries && Math.abs(window.scrollY - y) > 4) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };

    const unsubBefore = router.subscribe("onBeforeNavigate", () => {
      persist();
    });
    const unsubResolved = router.subscribe("onResolved", () => {
      currentHref = window.location.href;
      const saved = read()[currentHref];
      if (typeof saved === "number") {
        restore(saved);
      } else {
        window.scrollTo(0, 0);
      }
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      unsubBefore();
      unsubResolved();
    };
  }, [router]);

  return null;
}