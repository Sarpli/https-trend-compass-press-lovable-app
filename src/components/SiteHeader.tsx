import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Moon, Sun, Lock } from "lucide-react";
import { TickerBar } from "./TickerBar";

const NAV = [
  { to: "/", label: "Front Page" },
  { to: "/vote", label: "Vote" },
  { to: "/archive", label: "Archive" },
  { to: "/glossary", label: "My Glossary" },
  { to: "/pricing", label: "Subscribe" },
] as const;

export function SiteHeader() {
  const { user, isPro } = useAuth();
  const { theme, toggle } = useTheme();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <header>
      <TickerBar />
      <div className="masthead-rule bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-5">
          {/* Mobile layout */}
          <div className="md:hidden">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center">
                {isPro ? (
                  <button
                    onClick={toggle}
                    aria-label="Toggle dark mode"
                    title={theme === "dark" ? "Switch to light edition" : "Switch to dark edition"}
                    className="p-1.5 rounded hover:bg-foreground/10 transition-colors"
                  >
                    {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </button>
                ) : user ? (
                  <Link
                    to="/pricing"
                    aria-label="Dark mode is a Pro feature"
                    title="Dark mode — Pro only"
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Lock className="w-4 h-4" />
                  </Link>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs ui">
                {user ? (
                  <>
                    {isPro && <span className="small-caps text-xs text-accent-red">Pro</span>}
                    <Link to="/account" className="hover:underline">Account</Link>
                  </>
                ) : (
                  <Link to="/auth" className="hover:underline small-caps text-xs">Sign in</Link>
                )}
              </div>
            </div>
            <Link to="/" className="block text-center">
              <div className="text-[9px] ui small-caps text-muted-foreground">
                The Daily Edition of Internet Culture
              </div>
              <h1 className="display text-4xl font-black tracking-tight leading-none mt-1">
                Trenslate
              </h1>
              <div className="display italic text-xs mt-1 text-foreground/80">
                "Finally in the loop."
              </div>
            </Link>
          </div>

          {/* Desktop layout */}
          <div className="hidden md:grid grid-cols-3 items-center gap-4">
            <div className="text-xs ui small-caps text-muted-foreground">
              {today} · Vol. I · No. 1
            </div>
            <Link to="/" className="text-center min-w-0">
              <h1 className="display text-6xl font-black tracking-tight leading-none">
                Trenslate
              </h1>
              <div className="text-[10px] ui small-caps mt-1 text-muted-foreground">
                The Daily Edition of Internet Culture
              </div>
              <div className="display italic text-base mt-2 text-foreground/80">
                "Finally in the loop."
              </div>
            </Link>
            <div className="flex justify-end gap-3 items-center text-sm ui shrink-0">
              {isPro ? (
                <button
                  onClick={toggle}
                  aria-label="Toggle dark mode"
                  title={theme === "dark" ? "Switch to light edition" : "Switch to dark edition"}
                  className="p-1.5 rounded hover:bg-foreground/10 transition-colors"
                >
                  {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              ) : user ? (
                <Link
                  to="/pricing"
                  aria-label="Dark mode is a Pro feature"
                  title="Dark mode — Pro only"
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Lock className="w-4 h-4" />
                </Link>
              ) : null}
              {user ? (
                <>
                  {isPro && <span className="small-caps text-xs text-accent-red">Pro</span>}
                  <Link to="/account" className="hover:underline">Account</Link>
                </>
              ) : (
                <Link to="/auth" className="hover:underline small-caps text-xs">Sign in</Link>
              )}
            </div>
          </div>
        </div>
        <nav className="border-t border-foreground/80 border-b border-foreground/30 bg-background">
          <div className="max-w-7xl mx-auto px-6 flex justify-center gap-8 py-3 text-sm ui small-caps overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="whitespace-nowrap hover:text-accent-red transition-colors"
                activeProps={{ className: "text-accent-red" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}