import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Trenslate" },
      { name: "description", content: "Sign in or create an account to vote on trends and save your personal glossary." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate({ to: "/" });
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. Welcome to Trenslate.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-xs ui small-caps text-accent-red mb-2 text-center">
        Subscriber Services
      </div>
      <h1 className="display text-4xl font-black text-center mb-1">
        {mode === "signin" ? "Sign in" : "Create an account"}
      </h1>
      <p className="text-center text-sm text-muted-foreground mb-8">
        {mode === "signin" ? "Welcome back to the newsroom." : "Join the voting floor in seconds."}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="ui small-caps text-xs block mb-1">Email</label>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-ink/40 bg-background px-3 py-2 ui focus:outline-none focus:border-accent-red"
          />
        </div>
        <div>
          <label className="ui small-caps text-xs block mb-1">Password</label>
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-ink/40 bg-background px-3 py-2 ui focus:outline-none focus:border-accent-red"
          />
        </div>
        <button
          disabled={busy}
          className="w-full bg-ink text-newsprint py-3 ui small-caps tracking-wider hover:bg-accent-red transition-colors disabled:opacity-50"
        >
          {busy ? "..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <div className="text-center mt-6 text-sm">
        {mode === "signin" ? (
          <button onClick={() => setMode("signup")} className="ui small-caps text-xs underline">
            New subscriber? Create an account
          </button>
        ) : (
          <button onClick={() => setMode("signin")} className="ui small-caps text-xs underline">
            Already a subscriber? Sign in
          </button>
        )}
      </div>
      <p className="text-center mt-8 text-xs text-muted-foreground">
        <Link to="/" className="hover:underline">← Back to the front page</Link>
      </p>
    </div>
  );
}