import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

const STORAGE_PREFIX = "trendslated:pro-welcomed:";

export function ProWelcomeToast() {
  const { user, isPro, proWelcomedAt } = useAuth();

  useEffect(() => {
    if (!user || !isPro || !proWelcomedAt) return;
    const key = `${STORAGE_PREFIX}${user.id}`;
    const seen = localStorage.getItem(key);
    if (seen === proWelcomedAt) return;
    localStorage.setItem(key, proWelcomedAt);
    const t = setTimeout(() => {
      toast.success("Welcome to Pro.", {
        description:
          "After Hours, unlimited AI search, Year & All-Time voting, and the full archive are yours.",
        duration: 8000,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [user, isPro, proWelcomedAt]);

  return null;
}