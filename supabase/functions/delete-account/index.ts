// Deployed to the "gut log" Supabase project with verify_jwt disabled, same
// as stripe-webhook and send-reminders - this one is user-facing though, so
// it authenticates the caller itself (supabaseAdmin.auth.getUser(jwt))
// rather than skipping that step.
//
// NOT YET DEPLOYED - authored but never applied, since this session had no
// authenticated Supabase MCP connection to deploy it with. Before relying on
// this in production:
//   1. Deploy it (Supabase CLI `supabase functions deploy delete-account`,
//      or the dashboard's Edge Functions editor).
//   2. Test it end-to-end against a throwaway test account first - this
//      function was written without live access to this project's schema,
//      so it can't be fully verified from here. In particular:
//      - entries/profiles are deleted explicitly below rather than relying
//        on an assumed ON DELETE CASCADE to auth.users, since that wasn't
//        confirmed for those two tables (it IS confirmed for
//        push_subscriptions/reminder_settings/reminder_log, which cascade
//        on their own when step 4 runs).
//      - restrooms are intentionally NOT deleted: a saved spot is shared,
//        public data other users may rely on (see privacy.html section 3),
//        so this only detaches ownership (user_id -> null) rather than
//        deleting the spot itself. If restrooms.user_id turns out to be
//        NOT NULL with no explicit ON DELETE behavior, that update fails
//        safely (caught below) and the final admin.deleteUser call will
//        itself then fail with a clear FK-violation error instead of
//        silently cascading away spots other users depend on - if that
//        happens, the real fix is a migration that makes restrooms.user_id
//        nullable, not forcing this function to delete shared data.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  try {
    const { error: entriesErr } = await supabaseAdmin.from("entries").delete().eq("user_id", user.id);
    if (entriesErr) throw new Error(`entries: ${entriesErr.message}`);

    // Best-effort - see the file-level comment on why a failure here is
    // swallowed rather than treated as fatal.
    const { error: restroomsErr } = await supabaseAdmin
      .from("restrooms").update({ user_id: null }).eq("user_id", user.id);
    if (restroomsErr) {
      console.error("could not detach restroom ownership (continuing)", restroomsErr);
    }

    const { error: profileErr } = await supabaseAdmin.from("profiles").delete().eq("id", user.id);
    if (profileErr) throw new Error(`profiles: ${profileErr.message}`);

    const { error: deleteUserErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteUserErr) throw new Error(`auth.admin.deleteUser: ${deleteUserErr.message}`);
  } catch (e) {
    console.error("account deletion failed partway through", e);
    return new Response(
      JSON.stringify({
        error: "Account deletion did not complete. Some of your data may already be gone - contact support rather than retrying.",
      }),
      { status: 500 }
    );
  }

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
