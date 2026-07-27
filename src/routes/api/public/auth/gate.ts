import { createFileRoute } from "@tanstack/react-router";

// Server-side gate for sign-in / sign-up so we can rate-limit auth
// attempts by IP + email before they hit Supabase Auth. Supabase's own
// endpoints have coarse project-wide limits; this adds a second layer
// that fails-closed per (IP, email) with a friendly 429.
export const Route = createFileRoute("/api/public/auth/gate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { mode?: string; email?: string } = {};
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "bad_request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const mode = body.mode === "signup" ? "signup" : "signin";
        const email = (body.email ?? "").trim().toLowerCase();
        if (!email || email.length > 254 || !email.includes("@")) {
          return new Response(JSON.stringify({ error: "invalid_email" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const {
          enforceRateLimit,
          getClientIp,
          RateLimitError,
          rateLimitResponse,
        } = await import("@/lib/rate-limit.server");
        const ip = getClientIp(request);

        const checks =
          mode === "signup"
            ? [
                { bucket: "auth_signup:ip", key: ip, max: 5, windowSeconds: 300 },
                { bucket: "auth_signup:email", key: email, max: 3, windowSeconds: 3600 },
              ]
            : [
                { bucket: "auth_signin:ip", key: ip, max: 10, windowSeconds: 60 },
                { bucket: "auth_signin:ip_hour", key: ip, max: 60, windowSeconds: 3600 },
                { bucket: "auth_signin:email", key: email, max: 5, windowSeconds: 300 },
              ];

        try {
          await enforceRateLimit(checks);
        } catch (e) {
          if (e instanceof RateLimitError) return rateLimitResponse(e);
          throw e;
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});