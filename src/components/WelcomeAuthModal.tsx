import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function WelcomeAuthModal() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || user) return;
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [user, loading]);

  useEffect(() => {
    if (!open) return;
    const r = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(r);
  }, [open]);

  const dismiss = () => {
    setClosing(true);
    setShow(false);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 380);
  };

  if (!open || user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Welcome to Trenslate.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      dismiss();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apple = async () => {
    setBusy(true);
    try {
      const r = await lovable.auth.signInWithOAuth("apple", { redirect_uri: window.location.origin });
      if (r.error) throw new Error(r.error.message ?? "Apple sign-in failed");
      if (r.redirected) return;
      dismiss();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 transition-[background-color,backdrop-filter] duration-500 ease-out ${show && !closing ? "bg-black/60 backdrop-blur-sm" : "bg-black/0 backdrop-blur-0"}`}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transitionTimingFunction: show && !closing
            ? "cubic-bezier(0.22, 1.4, 0.36, 1)"
            : "cubic-bezier(0.4, 0, 0.6, 1)",
        }}
        className={`glass glass-sheen w-full md:max-w-md bg-background border border-ink/20 rounded-t-2xl md:rounded-lg shadow-2xl p-6 relative will-change-transform transition-[transform,opacity,filter] duration-[520ms] ${
          show && !closing
            ? "translate-y-0 opacity-100 blur-0 scale-100"
            : "translate-y-12 md:translate-y-6 opacity-0 blur-[6px] scale-[0.97]"
        }`}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded hover:bg-foreground/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="text-[10px] ui small-caps text-accent-red mb-1 text-center tracking-widest">
          Extra · Extra
        </div>
        <h2 className="display text-2xl md:text-3xl font-black text-center leading-tight mb-1">
          {mode === "signup" ? "Join the newsroom" : "Welcome back"}
        </h2>
        <p className="text-center text-xs text-muted-foreground mb-5">
          {mode === "signup"
            ? "Vote on trends, track streaks, save your glossary."
            : "Sign in to keep voting and saving."}
        </p>

        <button
          type="button"
          onClick={apple}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-black text-white py-2.5 ui small-caps text-xs tracking-wider hover:bg-black/85 transition-colors disabled:opacity-50 rounded"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M16.365 1.43c0 1.14-.42 2.23-1.18 3.06-.78.86-2.06 1.52-3.1 1.44-.13-1.1.43-2.25 1.16-3.06.81-.9 2.18-1.56 3.12-1.44zM20.5 17.34c-.55 1.27-.81 1.83-1.52 2.95-.99 1.57-2.38 3.52-4.11 3.54-1.53.02-1.93-1-4.01-.99-2.08.01-2.52 1.01-4.06.99-1.72-.02-3.04-1.78-4.03-3.34-2.77-4.38-3.06-9.51-1.35-12.24 1.21-1.93 3.12-3.06 4.92-3.06 1.83 0 2.98 1.01 4.49 1.01 1.47 0 2.36-1.01 4.48-1.01 1.6 0 3.3.88 4.51 2.4-3.97 2.18-3.33 7.88.68 9.75z" />
          </svg>
          Continue with Apple
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-ink/20" />
          <span className="ui small-caps text-[10px] text-muted-foreground">or email</span>
          <div className="flex-1 h-px bg-ink/20" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-ink/40 bg-background px-3 py-2 text-sm ui focus:outline-none focus:border-accent-red rounded"
          />
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="w-full border border-ink/40 bg-background px-3 py-2 text-sm ui focus:outline-none focus:border-accent-red rounded"
          />
          <button
            disabled={busy}
            className="w-full bg-ink text-newsprint py-2.5 ui small-caps text-xs tracking-wider hover:bg-accent-red transition-colors disabled:opacity-50 rounded"
          >
            {busy ? "..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="text-center mt-4">
          <button
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="ui small-caps text-[11px] underline text-muted-foreground"
          >
            {mode === "signup" ? "Already a subscriber? Sign in" : "New here? Create an account"}
          </button>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-4 leading-relaxed">
          By continuing you agree to our{" "}
          <Link to="/terms" className="underline">Terms &amp; Community Guidelines</Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline">Privacy Policy</Link>.
          Trenslate has zero tolerance for objectionable content or abusive users.
        </p>
      </div>
    </div>
  );
}
