-- Applied directly to the "gut log" Supabase project (iftxfnhwdyqzllzmjoca)
-- via the Supabase MCP tools, same as every other schema change in this
-- project's history (there's no local Supabase CLI / migration-tracked
-- setup here). Kept as a file for reference only - re-running it is safe
-- (create table/policy use "if not exists"/are idempotent enough for a
-- fresh apply, but this is not wired into any migration runner).

-- Push subscriptions: one row per device/browser a user has enabled reminders on.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create policy "Users can view their own push subscriptions"
  on public.push_subscriptions for select
  using ((select auth.uid()) = user_id);
create policy "Users can insert their own push subscriptions"
  on public.push_subscriptions for insert
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions for delete
  using ((select auth.uid()) = user_id);

-- Reminder settings: one row per user, holds all reminder-type config.
create table public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC',
  toilet_enabled boolean not null default false,
  toilet_times text[] not null default '{}',
  toilet_message text,
  meals_enabled boolean not null default false,
  meals_times text[] not null default '{}',
  meals_message text,
  symptoms_enabled boolean not null default false,
  symptoms_times text[] not null default '{}',
  symptoms_message text,
  medication_enabled boolean not null default false,
  medication_times text[] not null default '{}',
  medication_message text,
  water_enabled boolean not null default false,
  water_interval_minutes int not null default 120,
  water_start_time text not null default '09:00',
  water_end_time text not null default '21:00',
  water_message text,
  updated_at timestamptz not null default now()
);
alter table public.reminder_settings enable row level security;

create policy "Users can view their own reminder settings"
  on public.reminder_settings for select
  using ((select auth.uid()) = user_id);
create policy "Users can insert their own reminder settings"
  on public.reminder_settings for insert
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own reminder settings"
  on public.reminder_settings for update
  using ((select auth.uid()) = user_id);

-- Reminder log: dedup/snooze/dismiss state per user per reminder-type per local day.
create table public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('toilet','meals','symptoms','medication','water')),
  local_date date not null,
  last_notified_at timestamptz,
  snoozed_until timestamptz,
  dismissed boolean not null default false,
  primary key (user_id, reminder_type, local_date)
);
alter table public.reminder_log enable row level security;

create policy "Users can view their own reminder log"
  on public.reminder_log for select
  using ((select auth.uid()) = user_id);
create policy "Users can update their own reminder log"
  on public.reminder_log for update
  using ((select auth.uid()) = user_id);
create policy "Users can insert their own reminder log"
  on public.reminder_log for insert
  with check ((select auth.uid()) = user_id);

-- Indexes supporting existing hot queries (RLS filter + sort columns).
create index if not exists entries_user_id_ts_idx on public.entries (user_id, ts desc);
create index if not exists restrooms_clean_idx on public.restrooms (clean desc);
create index if not exists entries_rest_id_idx on public.entries (rest_id) where rest_id is not null;

-- Scheduling: fire send-reminders every 15 minutes via pg_net.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The shared secret pg_cron sends as a bearer token (so the edge function
-- can reject calls that didn't come from this cron job) lives in Vault, not
-- in this file - Vault is reachable over SQL, unlike Edge Function secrets,
-- so this migration can set it itself without a manual dashboard step:
--   select vault.create_secret('<a random secret>', 'cron_shared_secret', '...');
-- The edge function's own CRON_SHARED_SECRET secret (dashboard-only, see
-- supabase/functions/send-reminders/index.ts) must be set to that same
-- value by hand.
select
  cron.schedule(
    'send-reminders-every-15-min',
    '*/15 * * * *',
    $$
    select net.http_post(
      url := 'https://iftxfnhwdyqzllzmjoca.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret'
        )
      ),
      body := '{}'::jsonb
    );
    $$
  );
