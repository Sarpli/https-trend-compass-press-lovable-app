import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function todayLocalISO(tz?: string | null): string {
  const zone = tz || deviceTimezone();
  try {
    // en-CA gives YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

/** Returns the user's preferred timezone (profile.timezone) or device tz. */
export function useUserTimezone(): string {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["profile-timezone", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", user!.id)
        .maybeSingle();
      return (data?.timezone as string | null) ?? null;
    },
  });
  return data || deviceTimezone();
}