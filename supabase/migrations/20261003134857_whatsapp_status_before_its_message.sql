-- A delivery status that arrives before the message it describes.
--
-- Every outbound send asks Meta first and stores the row afterwards, because
-- the row needs the wamid Meta answers with. For a media reply from the Inbox
-- the gap was a whole storage upload of up to 16 MB; for a text or template it
-- is one more round trip. Meta's status callbacks do not wait for us: a fast
-- failure -- 131026 "undeliverable", 131047 "re-engagement" -- can reach the
-- webhook inside that gap. Its update matched no row, was dropped, and the
-- insert that followed wrote 'sent'. The thread then showed a message as on
-- its way that had already been refused, and nothing would ever correct it.
--
-- So a status for a wamid we do not have YET is held here, briefly, and the
-- insert that brings the row applies it. Done in the database rather than in
-- each sender, because there are half a dozen of those (Inbox, templates,
-- automations, appointment notifications, the public API, lead sequences) and
-- every one of them has the same gap.
--
-- The forward-only rule from the webhook (statusesThisMayReplace, #524) is
-- restated here as whatsapp_status_may_replace and used for both the update
-- and the hand-over: sent < delivered < read, 'failed' replaces anything short
-- of 'read', nothing replaces 'failed'.
--
-- Additive only: a new table, three new functions and a trigger. The code
-- live before this release keeps updating whatsapp_messages directly, and an
-- insert it makes passes through the trigger harmlessly when nothing is held.

create table public.whatsapp_pending_statuses (
  wamid text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  status text not null,
  error_code text,
  error_message text,
  received_at timestamptz not null default now()
);
create index whatsapp_pending_statuses_received_idx on public.whatsapp_pending_statuses (received_at);

-- Written and read only by the webhook (service role) and by the trigger below
-- (security definer). No policy: nobody signed in has any business here.
alter table public.whatsapp_pending_statuses enable row level security;
select public.require_two_factor_on('public.whatsapp_pending_statuses');

create or replace function public.whatsapp_status_may_replace(p_incoming text, p_stored text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_stored = 'failed' then false
    when p_incoming = 'failed' then p_stored in ('sent', 'delivered')
    else coalesce(array_position(array['sent', 'delivered', 'read'], p_incoming), 0)
       > coalesce(array_position(array['sent', 'delivered', 'read'], p_stored), 99)
  end;
$function$;

-- What the webhook calls for every status callback. Returns what it did:
-- 'applied' to the stored row, 'ignored' (the row exists and is already
-- further along, or the status is not one we track), or 'held' for the row
-- still to come.
--
-- The advisory lock on the wamid is what makes "no row yet" a safe thing to
-- conclude. Without it the insert could commit between this function's
-- update finding nothing and its hold being written, and the trigger -- which
-- had already looked -- would never see the hold. Both sides take the same
-- lock, so one of them always sees the other's work.
create or replace function public.record_whatsapp_status(
  p_account_id uuid,
  p_wamid text,
  p_status text,
  p_error_code text,
  p_error_message text
)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_rows integer;
begin
  if p_wamid is null or p_status not in ('delivered', 'read', 'failed') then
    return 'ignored';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('whatsapp_status:' || p_wamid, 0));

  update public.whatsapp_messages m
     set status = p_status,
         error_code = p_error_code,
         error_message = p_error_message,
         updated_at = now()
   where m.wamid = p_wamid
     and m.account_id = p_account_id
     and public.whatsapp_status_may_replace(p_status, m.status);
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return 'applied';
  end if;

  if exists (select 1 from public.whatsapp_messages m where m.wamid = p_wamid) then
    return 'ignored';
  end if;

  -- Statuses for messages that will never be stored here (sent by another
  -- system on the same number) would otherwise pile up. An hour is far longer
  -- than any send takes to store its row.
  delete from public.whatsapp_pending_statuses where received_at < now() - interval '1 hour';

  insert into public.whatsapp_pending_statuses as h (wamid, account_id, status, error_code, error_message)
  values (p_wamid, p_account_id, p_status, p_error_code, p_error_message)
  on conflict (wamid) do update
     set status = excluded.status,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         received_at = now()
   where public.whatsapp_status_may_replace(excluded.status, h.status)
     and h.account_id = excluded.account_id;
  return 'held';
end;
$function$;

revoke all on function public.record_whatsapp_status(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_status(uuid, text, text, text, text) to service_role;

-- Hands a held status to the row it was waiting for. Security definer because
-- the Inbox inserts as the signed-in member, who cannot read the holding table.
create or replace function public.apply_held_whatsapp_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_held public.whatsapp_pending_statuses%rowtype;
begin
  -- Only an outbound row can be waiting for a delivery status; an inbound
  -- one arrives as 'received' and is skipped without taking the lock.
  if new.wamid is null or new.status not in ('sent', 'delivered') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('whatsapp_status:' || new.wamid, 0));

  delete from public.whatsapp_pending_statuses h
   where h.wamid = new.wamid and h.account_id = new.account_id
  returning * into v_held;

  if found and public.whatsapp_status_may_replace(v_held.status, new.status) then
    new.status := v_held.status;
    new.error_code := v_held.error_code;
    new.error_message := v_held.error_message;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

revoke all on function public.apply_held_whatsapp_status() from public, anon, authenticated;

create trigger whatsapp_messages_apply_held_status
  before insert on public.whatsapp_messages
  for each row execute function public.apply_held_whatsapp_status();
