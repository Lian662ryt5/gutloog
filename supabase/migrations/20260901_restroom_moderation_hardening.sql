-- Follow-up to 20260901_restroom_moderation.sql addressing the Supabase
-- advisor findings surfaced right after that migration was applied.

-- recompute_restroom_report_state() is trigger-only; it has no business
-- being reachable as a public RPC endpoint (its SECURITY DEFINER made the
-- linter flag it as anon/authenticated-executable via
-- /rest/v1/rpc/recompute_restroom_report_state).
revoke execute on function public.recompute_restroom_report_state() from public, anon, authenticated;

-- is_admin() has to stay executable by `authenticated` (RLS policies that
-- call it run as the querying role and need EXECUTE), but the app never
-- reaches Postgres as plain `anon` - every request signs in anonymously
-- first - so drop that grant as defense-in-depth. Revoking from `anon`
-- alone isn't enough: new functions default-grant EXECUTE to PUBLIC, which
-- `anon` inherits from regardless, so PUBLIC has to be revoked too and
-- `authenticated` re-granted explicitly.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Two permissive SELECT policies on the same table/role/action both get
-- evaluated on every query; collapse into one OR'd policy each.
drop policy "Users can view their own restroom reports" on public.restroom_reports;
drop policy "Admins can view all restroom reports" on public.restroom_reports;
create policy "Users can view their own or admins can view all restroom reports"
  on public.restroom_reports for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

drop policy "Admins can delete any restroom" on public.restrooms;
drop policy "Users can delete their own restroom entries" on public.restrooms;
create policy "Owners or admins can delete restrooms"
  on public.restrooms for delete to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

-- Covering indexes for the two new foreign keys.
create index restroom_reports_user_id_idx on public.restroom_reports (user_id);
create index restrooms_reviewed_by_idx on public.restrooms (reviewed_by) where reviewed_by is not null;
