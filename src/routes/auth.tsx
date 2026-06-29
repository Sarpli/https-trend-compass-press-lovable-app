import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
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
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
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

  const signInWithApple = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw new Error(result.error.message ?? "Apple sign-in failed");
      if (result.redirected) return;
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
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-ink/20" />
        <span className="ui small-caps text-[10px] text-muted-foreground">or</span>
        <div className="flex-1 h-px bg-ink/20" />
      </div>
      <button
        type="button"
        onClick={signInWithApple}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 bg-black text-white py-3 ui small-caps tracking-wider hover:bg-black/85 transition-colors disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
          <path d="M16.365 1.43c0 1.14-.42 2.23-1.18 3.06-.78.86-2.06 1.52-3.1 1.44-.13-1.1.43-2.25 1.16-3.06.81-.9 2.18-1.56 3.12-1.44zM20.5 17.34c-.55 1.27-.81 1.83-1.52 2.95-.99 1.57-2.38 3.52-4.11 3.54-1.53.02-1.93-1-4.01-.99-2.08.01-2.52 1.01-4.06.99-1.72-.02-3.04-1.78-4.03-3.34-2.77-4.38-3.06-9.51-1.35-12.24 1.21-1.93 3.12-3.06 4.92-3.06 1.83 0 2.98 1.01 4.49 1.01 1.47 0 2.36-1.01 4.48-1.01 1.6 0 3.3.88 4.51 2.4-3.97 2.18-3.33 7.88.68 9.75z" />
        </svg>
        Sign in with Apple
      </button>
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