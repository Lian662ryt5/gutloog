-- Lightweight client-side error tracking. Applied directly to the "gut
-- log" Supabase project (iftxfnhwdyqzllzmjoca) via the Supabase MCP
-- tools, same as every other schema change in this project's history.
-- Kept as a file for reference only - not wired into any migration runner.

-- No third-party error-tracking service, no new CDN dependency, no CSP
-- changes - uncaught client errors are just inserted here (see
-- js/error-tracking.js) and reviewed via the Supabase SQL editor/dashboard,
-- the same way this project's owner already reviews cron runs and advisors.
create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  message text not null,
  stack text,
  url text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
create index client_errors_created_at_idx on public.client_errors (created_at desc);

-- Insert-only from the client - nothing reads this table back through the
-- app, so there's no select policy for regular users. Deliberately no
-- update/delete policy either: error logs shouldn't be editable client-side.
create policy "Users can insert their own client errors"
  on public.client_errors for insert to authenticated
  with check ((select auth.uid()) = user_id);
