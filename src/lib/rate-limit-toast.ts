import { toast } from "sonner";

/**
 * Show a persistent rate-limit toast with a live countdown and a link to
 * /help/rate-limits explaining why the limit was hit. Reads the exact
 * Retry-After seconds from the response so the number the user sees is
 * the same one the server enforced.
 */
export function showRateLimitToast(response: Response, context?: string) {
  const raw = Number(response.headers.get("Retry-After") ?? "60");
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 60;
  showRateLimitToastSeconds(seconds, context);
}

export function showRateLimitToastSeconds(seconds: number, context?: string) {
  const id = `rate-limit-${context ?? "generic"}`;
  const label = context ? `Too many ${context} attempts` : "Too many requests";
  const format = (s: number) => {
    if (s <= 0) return "You can try again now.";
    if (s < 60) return `Try again in ${s}s.`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `Try again in ${m}m ${rem}s.` : `Try again in ${m}m.`;
  };

  let remaining = Math.max(1, Math.ceil(seconds));
  const render = () => {
    toast.error(label, {
      id,
      description: `${format(remaining)} This limit protects the app from abuse.`,
      duration: Math.max(1500, remaining * 1000),
      action: {
        label: "Why?",
        onClick: () => {
          window.open("/help/rate-limits", "_blank", "noopener,noreferrer");
        },
      },
    });
  };

  render();
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      toast.dismiss(id);
      return;
    }
    render();
  }, 1000);
}