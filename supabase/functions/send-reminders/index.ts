// Deployed to the "gut log" Supabase project (iftxfnhwdyqzllzmjoca) with
// verify_jwt disabled, and invoked every 15 minutes by a pg_cron job
// ("send-reminders-every-15-min") calling this URL via pg_net - see the
// setup_reminders_cron migration for the exact cron.schedule() call. It's
// not user-facing, so it checks CRON_SHARED_SECRET below instead of a user
// JWT, since the caller is Postgres, not a signed-in user.
//
// Requires two manually-configured secrets this deploy tool can't set
// itself (Supabase Edge Function secrets are write-only, dashboard-only -
// open this project's Edge Functions -> Secrets to add them):
//   - VAPID_PRIVATE_KEY: the private half of the VAPID key pair generated
//     for this feature. Until it's set, every invocation returns a clean
//     500 "VAPID_PRIVATE_KEY not configured" rather than sending anything.
//   - CRON_SHARED_SECRET: must match the value stored in this project's
//     Vault under the name "cron_shared_secret" (that part IS already set -
//     see the migration - since Vault, unlike Edge Function secrets, is
//     reachable over SQL). Until this matches, every pg_cron-triggered call
//     gets a 401.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BIyUGijZoChwoBuAVBMs2kvWmt9b3WK2q0F1-WrNgiMBhclSuJl8_x0Ic5JIVQz7rYVSjBg8oixF2TdNWc0B9_0";

// Finds the UTC instant that corresponds to `${localDateStr}T00:00:00` in an
// arbitrary IANA timezone, by iteratively converging with Intl.DateTimeFormat
// rather than assuming the local day is exactly 24h - it isn't, on the two
// DST-transition days a year in a zone that observes DST (23h or 25h), and a
// fixed-offset subtraction gets the boundary wrong on exactly those days.
function localDateStartInstantUTC(localDateStr: string, tz: string): Date {
  let guess = new Date(`${localDateStr}T00:00:00Z`);
  const target = guess.getTime();
  for (let i = 0; i < 3; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, x.value]));
    const reportedAsUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const diff = target - reportedAsUTC;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function nextCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

type ReminderType = "toilet" | "meals" | "symptoms" | "medication" | "water";

const REMINDER_TYPE_META: Record<ReminderType, { entryKind: string; defaultMessage: string }> = {
  toilet:     { entryKind: "stool",      defaultMessage: "Time to check in — log a visit if you've been." },
  meals:      { entryKind: "food",       defaultMessage: "Don't forget to log what you've eaten." },
  symptoms:   { entryKind: "stool",      defaultMessage: "How are you feeling? Log any symptoms." },
  medication: { entryKind: "medication", defaultMessage: "Time for your medication." },
  water:      { entryKind: "water",      defaultMessage: "Stay hydrated — log some water." },
};

Deno.serve(async (req) => {
  const cronSharedSecret = Deno.env.get("CRON_SHARED_SECRET");
  if (!cronSharedSecret || req.headers.get("authorization") !== `Bearer ${cronSharedSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivateKey) {
    console.error("VAPID_PRIVATE_KEY is not set");
    return new Response("VAPID_PRIVATE_KEY not configured", { status: 500 });
  }
  webpush.setVapidDetails("mailto:lianbusiness89@gmail.com", VAPID_PUBLIC_KEY, vapidPrivateKey);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: settingsRows, error: settingsErr } = await supabase
    .from("reminder_settings")
    .select("*")
    .or("toilet_enabled.eq.true,meals_enabled.eq.true,symptoms_enabled.eq.true,medication_enabled.eq.true,water_enabled.eq.true");

  if (settingsErr) {
    console.error("failed to load reminder_settings", settingsErr);
    return new Response("error", { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const settings of settingsRows ?? []) {
    const tz = settings.timezone || "UTC";
    const now = new Date();

    let localDate: string;
    let minutesOfDay: number;
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      });
      const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
      localDate = `${parts.year}-${parts.month}-${parts.day}`;
      minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
    } catch (e) {
      console.error("invalid timezone for user", settings.user_id, tz, e);
      continue;
    }

    for (const type of Object.keys(REMINDER_TYPE_META) as ReminderType[]) {
      if (!settings[`${type}_enabled`]) continue;

      let due = false;
      if (type === "water") {
        const [sh, sm] = String(settings.water_start_time || "09:00").split(":").map(Number);
        const [eh, em] = String(settings.water_end_time || "21:00").split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const interval = settings.water_interval_minutes || 120;
        if (minutesOfDay >= startMin && minutesOfDay <= endMin) {
          due = ((minutesOfDay - startMin) % interval) < 15;
        }
      } else {
        const times: string[] = settings[`${type}_times`] || [];
        due = times.some((t) => {
          const [th, tm] = t.split(":").map(Number);
          const diff = minutesOfDay - (th * 60 + tm);
          return diff >= 0 && diff < 15; // fires within the 15-min tick after the scheduled time
        });
      }
      if (!due) continue;

      const { data: logRow } = await supabase
        .from("reminder_log")
        .select("*")
        .eq("user_id", settings.user_id)
        .eq("reminder_type", type)
        .eq("local_date", localDate)
        .maybeSingle();

      if (logRow) {
        if (logRow.dismissed) { skipped++; continue; }
        if (logRow.snoozed_until && new Date(logRow.snoozed_until) > now) { skipped++; continue; }
        if (logRow.last_notified_at && (now.getTime() - new Date(logRow.last_notified_at).getTime()) < 20 * 60000) { skipped++; continue; }
      }

      // Skip if already logged today (this reminder type's local calendar
      // day) - the window is the user's actual local midnight-to-midnight,
      // not a fixed 24h span, so it stays correct on DST-transition days too.
      const meta = REMINDER_TYPE_META[type];
      const dayStartUTC = localDateStartInstantUTC(localDate, tz);
      const dayEndUTC = localDateStartInstantUTC(nextCalendarDate(localDate), tz);
      const { data: loggedRows, error: loggedErr } = await supabase
        .from("entries")
        .select("id")
        .eq("user_id", settings.user_id)
        .eq("kind", meta.entryKind)
        .gte("ts", dayStartUTC.toISOString())
        .lt("ts", dayEndUTC.toISOString())
        .limit(1);
      if (loggedErr) console.error("logged-today check failed", loggedErr);
      if (loggedRows && loggedRows.length) { skipped++; continue; }

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", settings.user_id);
      if (!subs || !subs.length) continue;

      const message = settings[`${type}_message`] || meta.defaultMessage;
      const payload = JSON.stringify({ title: "Gut Log", body: message, type });

      let anySent = false;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          );
          anySent = true;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          console.error("push send failed", sub.endpoint, statusCode);
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }

      if (anySent) {
        sent++;
        await supabase.from("reminder_log").upsert(
          { user_id: settings.user_id, reminder_type: type, local_date: localDate, last_notified_at: now.toISOString() },
          { onConflict: "user_id,reminder_type,local_date" }
        );
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped }), {
    headers: { "Content-Type": "application/json" }
  });
});
