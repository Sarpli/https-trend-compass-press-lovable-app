import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  trendId: z.string().uuid(),
  slug: z.string().min(1).max(120),
  url: z.string().url(),
});

export const importTrendImageFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Authorize: must be admin (RLS-safe via has_role security definer fn).
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden — admin role required");

    // Fetch remote image server-side (bypasses browser CORS).
    const res = await fetch(data.url, {
      headers: { "User-Agent": "TrendslatedBot/1.0" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Source returned ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Not an image (got ${contentType})`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error("Empty image response");
    if (buf.byteLength > 8 * 1024 * 1024) throw new Error("Image larger than 8 MB");

    const ext = contentType.split("/")[1]?.split(";")[0]?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext) ? ext : "jpg";
    const path = `${data.slug}-${Date.now()}.${safeExt}`;

    // Use service-role for storage write + trends update — caller is verified admin.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: upErr } = await supabaseAdmin.storage
      .from("trend-images")
      .upload(path, buf, { upsert: true, contentType });
    if (upErr) throw new Error(upErr.message);

    const tenYears = 60 * 60 * 24 * 365 * 10;
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("trend-images")
      .createSignedUrl(path, tenYears);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "No signed URL");

    const { error: updErr } = await supabaseAdmin
      .from("trends")
      .update({ image_url: signed.signedUrl })
      .eq("id", data.trendId);
    if (updErr) throw new Error(updErr.message);

    return { imageUrl: signed.signedUrl };
  });