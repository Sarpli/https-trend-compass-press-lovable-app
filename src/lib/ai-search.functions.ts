import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const Input = z.object({ query: z.string().min(1).max(200) });

export const aiSearchTrends = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { data: trends, error } = await supabase
      .from("trends")
      .select("slug, term, category, plain_language");
    if (error) throw error;
    if (!trends?.length) return { slugs: [] as string[] };

    const catalog = trends
      .map((t) => `- ${t.slug} | ${t.term} | ${t.category ?? "?"} | ${(t.plain_language ?? "").slice(0, 140)}`)
      .join("\n");

    const system = `You are a cultural-trend librarian. The user gives a search query (could be a term, a vibe, a category like "fashion", "memes", a person, an emotion). Return ALL trend slugs from the catalog that are relevant — including by category, theme, origin, or related concept. Be generous: if the query is broad (e.g. "fashion"), return every fashion/aesthetic trend. Respond ONLY with compact JSON: {"slugs":["slug1","slug2"]}. No prose.`;
    const user = `Query: ${data.query}\n\nCatalog (slug | term | category | summary):\n${catalog}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
    if (!res.ok) throw new Error(`AI gateway error ${res.status}`);

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { slugs?: unknown } = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const valid = new Set(trends.map((t) => t.slug));
    const slugs = Array.isArray(parsed.slugs)
      ? (parsed.slugs as unknown[]).filter((s): s is string => typeof s === "string" && valid.has(s))
      : [];
    return { slugs };
  });