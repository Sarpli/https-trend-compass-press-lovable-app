export function currentPeriodKey(category: "week" | "month" | "year" | "oat"): string {
  if (category === "oat") return "all";
  const d = new Date();
  if (category === "year") return String(d.getUTCFullYear());
  if (category === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  // ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const CATEGORY_LABEL: Record<"week" | "month" | "year" | "oat", string> = {
  week: "Trend of the Week",
  month: "Trend of the Month",
  year: "Trend of the Year",
  oat: "Trend of All Time",
};