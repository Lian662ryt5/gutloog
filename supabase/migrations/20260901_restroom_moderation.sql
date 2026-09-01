-- Restroom moderation: reports table, admin flag, and hide-pending-review
-- workflow for heavily-reported spots.
-- Applied directly to the "gut log" Supabase project (iftxfnhwdyqzllzmjoca)
-- via the Supabase MCP tools, same as every other schema change in this
-- project's history (there's no local Supabase CLI / migration-tracked
-- setup here). Kept as a file for reference only - re-running it is not
-- safe as-is (drops/creates named policies), so treat it as a record of
-- what was applied, not something to replay.

-- Admin flag. This app only has anonymous auth (no email/password sign-in),
-- so there's no self-serve way to become an admin - promoting someone is a
-- manual update against their auth user id (shown to them in Profile under
-- "Account ID"), e.g.:
--   update public.profiles set is_admin = true where id = '<uuid>';
alter table public.profiles add column is_admin boolean not null default false;

-- SECURITY DEFINER so it can be used inside RLS policies on other tables
-- without those policies needing their own access to profiles (which only
-- allows a user to select their own row).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path to ''
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to authenticated;

-- One report per user per spot - stops a single person inflating the count,
-- and gives moderators an actual reason instead of a bare number.
create table public.restroom_reports (
  id bigint generated always as identity primary key,
  restroom_id bigint not null references public.restrooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (reason in ('closed','incorrect_info','inappropriate','spam','other')),
  note text,
  created_at timestamptz not null default now(),
  unique (restroom_id, user_id)
);
alter table public.restroom_reports enable row level security;
create index restroom_reports_restroom_id_idx on public.restroom_reports (restroom_id);

create policy "Users can insert their own restroom reports"
  on public.restroom_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can view their own restroom reports"
  on public.restroom_reports for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Admins can view all restroom reports"
  on public.restroom_reports for select to authenticated
  using (public.is_admin());
create policy "Admins can delete restroom reports"
  on public.restroom_reports for delete to authenticated
  using (public.is_admin());

-- Moderation state on the restroom itself. report_count/hidden are now
-- server-computed (via the trigger below) from restroom_reports, not
-- client-writable - see the dropped "Anyone authenticated can update report
-- count" policy below, which let any signed-in user rewrite ANY field on
-- ANY restroom row (qual/with_check were both bare "true"), not just the
-- count it was meant for.
alter table public.restrooms
  add column hidden boolean not null default false,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id);
create index restrooms_hidden_idx on public.restrooms (hidden) where hidden;

-- Threshold: 3 distinct reporters is enough of a signal on a small, mostly
-- non-adversarial user base to pull a spot from public view pending review,
-- without one determined person being able to hide it alone. Once hidden,
-- it stays hidden until an admin reviews it (deleting reports doesn't
-- silently un-hide it).
create or replace function public.recompute_restroom_report_state()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  target_id bigint := coalesce(new.restroom_id, old.restroom_id);
  cnt integer;
begin
  select count(*) into cnt from public.restroom_reports where restroom_id = target_id;
  update public.restrooms
    set report_count = cnt,
        hidden = case when cnt >= 3 then true else hidden end
    where id = target_id;
  return coalesce(new, old);
end;
$$;

create trigger restroom_reports_recompute
  after insert or delete on public.restroom_reports
  for each row execute function public.recompute_restroom_report_state();

-- Replace the broken "anyone can update anything" policy. There's no
-- edit-restroom feature (only save/delete), so no owner-update policy is
-- needed - only admins can update a restroom row now (to unhide/reset
-- after review, or correct bad data before doing so).
drop policy "Anyone authenticated can update report count" on public.restrooms;
create policy "Admins can update restrooms"
  on public.restrooms for update to authenticated
  using (public.is_admin());

-- Admins can remove a listing outright during review, in addition to the
-- existing owner-delete policy.
create policy "Admins can delete any restroom"
  on public.restrooms for delete to authenticated
  using (public.is_admin());

-- Hidden-pending-review spots drop out of the public list. The saver still
-- sees their own spot (client marks it "pending review" - see
-- js/restrooms.js) so they know why others can't; admins see everything.
drop policy "Anyone authenticated can view restrooms" on public.restrooms;
create policy "Authenticated users can view visible restrooms"
  on public.restrooms for select to authenticated
  using (hidden = false or (select auth.uid()) = user_id or public.is_admin());
