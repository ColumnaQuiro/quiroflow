-- Lets the iOS home-screen widget fetch its own figures while the app is
-- closed (server/api/widget/home.get.ts), instead of showing only what the
-- app last wrote -- an owner's widget read "hace 3 h" whenever the app had
-- not been opened since the morning.
--
-- The widget extension does not get a Supabase session. A refresh token is
-- single-use: if the extension refreshed one, the app's copy would be spent
-- and the app signed out (or, past the reuse window, the whole session
-- revoked). So the app asks for a widget token instead: a random secret,
-- stored here only as its hash, that can do exactly one thing -- run
-- get_home_widget as the person who asked for it.
--
-- A token belongs to the auth session that issued it, and is only good
-- while that session is. Signing out on the phone revokes the session
-- (signOut({ scope: 'local' }) still calls /logout), and so the widget;
-- "sign out everywhere" or an admin revoking sessions does the same.
--
-- Two-factor is the session's, read afresh on every fetch: get_home_widget
-- runs with that session's current aal, so a clinic that starts requiring
-- two-factor after the token was issued stops a password-only session's
-- widget the same way it stops the app.

create table public.home_widget_tokens (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.home_widget_tokens enable row level security;
select public.require_two_factor_on('public.home_widget_tokens');
-- No policies, and no grants:
-- table-grants-ok: home_widget_tokens: holds credentials; only the security-definer functions below read or write it

-- The app, signed in (and past its second factor): a new token for this
-- session, replacing any earlier one. Returned once; only the hash is kept.
create or replace function public.issue_home_widget_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null or v_session is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;

  -- This person's tokens whose sessions have ended: nothing can use them.
  delete from public.home_widget_tokens t
   where t.user_id = auth.uid()
     and not exists (select 1 from auth.sessions s where s.id = t.session_id);

  insert into public.home_widget_tokens (session_id, user_id, token_hash)
  values (v_session, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (session_id) do update
    set user_id = excluded.user_id, token_hash = excluded.token_hash, created_at = now(), last_used_at = null;

  return v_token;
end;
$$;

revoke all on function public.issue_home_widget_token() from public, anon;
grant execute on function public.issue_home_widget_token() to authenticated;

-- get_home_widget, run as the role "authenticated" rather than as its
-- caller. Owned by that role on purpose: a security definer function runs as
-- its owner, so this one runs WITHOUT bypassing RLS, and every read inside
-- get_home_widget is scoped exactly as it is in the app -- as long as the
-- caller has set the JWT claims, which home_widget_for_token does. Called
-- directly by a signed-in user it is get_home_widget with their own claims,
-- so it hands out nothing they could not already ask for.
create or replace function public.home_widget_as_authenticated(p_account_id uuid, p_time_zone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_home_widget(p_account_id, p_time_zone);
$$;

alter function public.home_widget_as_authenticated(uuid, text) owner to authenticated;
revoke all on function public.home_widget_as_authenticated(uuid, text) from public, anon;

-- The widget, through the server: its token, the clinic and its time zone.
-- Raises 28000 when the token is unknown or its session has ended (the
-- widget forgets it), and whatever get_home_widget raises otherwise -- 42501
-- for a pending second factor or someone no longer on the team.
create or replace function public.home_widget_for_token(p_token text, p_account_id uuid, p_time_zone text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.home_widget_tokens;
  v_aal text;
begin
  select * into v_row from public.home_widget_tokens
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_row.session_id is null then
    raise exception 'Unknown widget token' using errcode = '28000';
  end if;

  select s.aal::text into v_aal from auth.sessions s
   where s.id = v_row.session_id
     and s.user_id = v_row.user_id
     and (s.not_after is null or s.not_after > now());
  if v_aal is null then
    delete from public.home_widget_tokens where session_id = v_row.session_id;
    raise exception 'Widget token session has ended' using errcode = '28000';
  end if;

  update public.home_widget_tokens set last_used_at = now() where session_id = v_row.session_id;

  -- Who get_home_widget (and every RLS policy under it) sees as the caller:
  -- this session, at its current assurance level. Local to the transaction.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_row.user_id,
    'role', 'authenticated',
    'aal', coalesce(v_aal, 'aal1'),
    'session_id', v_row.session_id
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_row.user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  return public.home_widget_as_authenticated(p_account_id, p_time_zone);
end;
$$;

revoke all on function public.home_widget_for_token(text, uuid, text) from public, anon, authenticated;
grant execute on function public.home_widget_for_token(text, uuid, text) to service_role;
