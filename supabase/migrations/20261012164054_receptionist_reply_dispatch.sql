-- The AI receptionist, one conversation per call.
--
-- The tick (receptionist-draft-cron) used to draft and send for up to 25
-- leads and 25 patients in one function call, three at a time. A Netlify
-- function has 60 seconds, a reply takes 3-10 (more with a calendar lookup
-- or a booking), so a busy tick -- several clinics, a burst of messages --
-- would be cut off half way. Worse, cut off after sending a reply but before
-- recording it, the next tick answered the same message again.
--
-- Now the tick only decides who is due and hands each conversation to its
-- own call (/api/automations/receptionist-reply), through pg_net -- the
-- database makes the requests, in parallel, without the tick waiting for
-- them. Each call has the whole 60 seconds for one conversation.
--
-- receptionist_reply_leases: one row per conversation being answered. A call
-- claims it (claim_receptionist_lease) before doing anything and releases it
-- after; a second call for the same conversation -- the next tick, while
-- this one is still writing -- gets nothing and stops. A call killed half
-- way leaves the lease to expire (90 s, past the 60 s limit), so the
-- conversation is retried, never stuck. Only the service role touches it.

create table public.receptionist_reply_leases (
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_key text not null,
  leased_until timestamptz not null,
  primary key (account_id, conversation_key)
);
alter table public.receptionist_reply_leases enable row level security;
select public.require_two_factor_on('public.receptionist_reply_leases');
revoke all on public.receptionist_reply_leases from anon, authenticated;

-- True for the one caller that gets the conversation; false while another
-- holds an unexpired lease on it.
create or replace function public.claim_receptionist_lease(p_account_id uuid, p_conversation_key text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  insert into public.receptionist_reply_leases as l (account_id, conversation_key, leased_until)
  values (p_account_id, p_conversation_key, now() + make_interval(secs => p_seconds))
  on conflict (account_id, conversation_key) do update
    set leased_until = excluded.leased_until
    where l.leased_until < now()
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.release_receptionist_lease(p_account_id uuid, p_conversation_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.receptionist_reply_leases where account_id = p_account_id and conversation_key = p_conversation_key;
$$;

-- One conversation's call, made by the database (pg_net) so the tick does
-- not wait on it. The URL and the cron secret come from the tick, which has
-- both; neither is stored here. 60 s timeout, the function's own limit, so
-- net._http_response records how the call actually ended.
create or replace function public.dispatch_receptionist_reply(p_url text, p_secret text, p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  return net.http_post(
    url := p_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', p_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.claim_receptionist_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_receptionist_lease(uuid, text) from public, anon, authenticated;
revoke all on function public.dispatch_receptionist_reply(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_receptionist_lease(uuid, text, integer) to service_role;
grant execute on function public.release_receptionist_lease(uuid, text) to service_role;
grant execute on function public.dispatch_receptionist_reply(text, text, jsonb) to service_role;
