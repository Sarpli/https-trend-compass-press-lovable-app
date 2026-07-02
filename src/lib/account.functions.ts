import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently delete the signed-in user's account and all associated data.
 * Required by Apple App Store guideline 5.1.1(v): apps that let users create
 * an account must let them initiate deletion of the account from within the app.
 *
 * Cascades: public.profiles, public.votes, public.searches, public.learned_trends,
 * public.trend_reports (reporter_id set null), public.user_roles, and finally
 * the auth.users record itself.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Best-effort cleanup of user-owned rows in public schema.
    // Any table with a FK to auth.users(id) ON DELETE CASCADE will clear
    // automatically when the auth user is deleted below; the explicit
    // deletes here cover tables without cascade.
    await Promise.allSettled([
      supabaseAdmin.from("votes").delete().eq("user_id", userId),
      supabaseAdmin.from("searches").delete().eq("user_id", userId),
      supabaseAdmin.from("learned_trends").delete().eq("user_id", userId),
      supabaseAdmin.from("user_roles").delete().eq("user_id", userId),
      supabaseAdmin.from("profiles").delete().eq("id", userId),
    ]);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });