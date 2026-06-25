import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
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
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <header>
      <TickerBar />
      <div className="masthead-rule bg-background">
        <div className="max-w-7xl mx-auto px-6 py-5 grid grid-cols-3 items-center gap-4">
          <div className="text-xs ui small-caps text-muted-foreground hidden md:block">
            {today} · Vol. I · No. 1
          </div>
          <Link to="/" className="text-center">
            <h1 className="display text-4xl md:text-6xl font-black tracking-tight leading-none">
              Trenslate
            </h1>
            <div className="text-[10px] ui small-caps mt-1 text-muted-foreground">
              The Daily Edition of Internet Culture
            </div>
          </Link>
          <div className="flex justify-end gap-3 items-center text-sm ui">
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
        <nav className="border-t border-ink/80 border-b border-ink/30 bg-background">
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