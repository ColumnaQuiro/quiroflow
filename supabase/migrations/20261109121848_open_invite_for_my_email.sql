-- Someone invited to a clinic who reaches sign-up by any route other than the
-- invite link -- a different browser, the Gmail in-app browser for the link
-- and Safari for the confirmation, or straight to the home page -- arrived on
-- /onboarding with nothing to say an invite existed. The invite token only
-- ever lived in localStorage of the browser that opened /join. So they did
-- what the page asked, created a practice of their own, and from then on the
-- invite was refused with "You already belong to a practice" while the owner
-- who sent it saw nobody join.
--
-- The invite is addressed to an email, and by the time someone is on
-- /onboarding Supabase has confirmed theirs. This hands back the open invite
-- for that address so the page can offer to join it before offering to build
-- a new practice.
--
-- The token is returned to the person the invite was emailed to, who holds
-- it already; the confirmed-email check is what makes that true. It answers
-- nothing to anyone who is already a member somewhere, the same condition
-- accept_invite refuses on, so it never offers an invite that cannot be
-- accepted.
create or replace function public.get_my_open_invite()
returns table(token text, account_name text, role_name text)
language sql
stable
security definer
set search_path = public
as $$
  select i.token, a.name, coalesce(r.name, i.role)
  from auth.users u
  join account_invites i on lower(trim(i.email)) = lower(u.email)
  join accounts a on a.id = i.account_id
  left join account_roles r on r.id = i.role_id
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and i.accepted_at is null
    and not exists (select 1 from team_members tm where tm.user_id = u.id)
  order by i.created_at desc
  limit 1
$$;

revoke all on function public.get_my_open_invite() from public, anon;
grant execute on function public.get_my_open_invite() to authenticated;
