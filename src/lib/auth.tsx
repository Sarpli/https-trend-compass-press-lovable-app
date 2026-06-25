import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Tier = "free" | "pro_monthly" | "pro_annual";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tier: Tier;
  isPro: boolean;
  isAnnual: boolean;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const { data: sub } = useQuery({
    queryKey: ["subscription", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("tier,status,current_period_end")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  const tier: Tier = (sub?.tier as Tier) ?? "free";
  const isActive = sub?.status === "active" &&
    (!sub?.current_period_end || new Date(sub.current_period_end) > new Date());
  const isPro = (tier === "pro_monthly" || tier === "pro_annual") && isActive;
  const isAnnual = tier === "pro_annual" && isActive;

  return (
    <AuthCtx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        tier,
        isPro,
        isAnnual,
        signOut: async () => { await supabase.auth.signOut(); },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}