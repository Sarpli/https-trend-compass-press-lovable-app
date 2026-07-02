import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="mt-16 rule-top">
      <div className="max-w-7xl mx-auto px-6 py-10 grid md:grid-cols-3 gap-8 text-sm">
        <div>
          <div className="display text-2xl font-black">Trenslate</div>
          <p className="text-muted-foreground mt-2">
            A field guide to internet culture. Read it like a newspaper, vote like a stock market.
          </p>
        </div>
        <div className="ui">
          <div className="small-caps text-xs text-muted-foreground mb-2">Sections</div>
          <ul className="space-y-1">
            <li><Link to="/" className="hover:underline">Front Page</Link></li>
            <li><Link to="/vote" className="hover:underline">Voting Floor</Link></li>
            <li><Link to="/archive" className="hover:underline">Trend Archive</Link></li>
          </ul>
        </div>
        <div className="ui">
          <div className="small-caps text-xs text-muted-foreground mb-2">About</div>
          <ul className="space-y-1">
            <li><Link to="/pricing" className="hover:underline">Subscribe</Link></li>
            <li><Link to="/auth" className="hover:underline">Sign in</Link></li>
            <li><Link to="/privacy" className="hover:underline">Privacy</Link></li>
            <li><Link to="/terms" className="hover:underline">Terms &amp; Guidelines</Link></li>
          </ul>
        </div>
      </div>
      <div className="rule-top">
        <div className="max-w-7xl mx-auto px-6 py-4 text-xs text-muted-foreground ui flex justify-between">
          <span>© {new Date().getFullYear()} Trenslate</span>
          <span className="small-caps">All Trends, All The Time</span>
        </div>
      </div>
    </footer>
  );
}