-- Restrict which profile columns a regular signed-in user can update
-- directly. The existing "Users can update own profile" RLS policy only
-- restricts *which row* (auth.uid() = id), not which columns, since it has
-- no WITH CHECK clause - meaning any signed-in user could previously call
-- sb.from('profiles').update({tier: 'lifetime'}) or update({is_admin:true})
-- on their own row directly (e.g. from the browser console), bypassing
-- Stripe entirely and/or granting themselves moderation-admin access.
--
-- The client only ever updates avatar_url/username/theme (js/profile.js,
-- js/themes.js). tier, is_admin, and the stripe_* columns are only ever
-- meant to be written by the stripe-webhook edge function, which uses the
-- service-role key and so is unaffected by this change (service_role
-- bypasses RLS entirely and has its own separate grants).
--
-- Verified live via has_column_privilege() after applying: authenticated
-- can no longer UPDATE tier/is_admin/stripe_customer_id/stripe_subscription_id
-- but can still UPDATE avatar_url/username/theme; service_role is unaffected.
revoke update on public.profiles from authenticated;
grant update (avatar_url, username, theme) on public.profiles to authenticated;
