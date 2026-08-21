-- Public patient doc links: a patient fills out a doc (consent form, etc.)
-- themselves via an unguessable link, the same way online booking works
-- (0012_online_booking.sql) -- security definer RPCs granted to anon,
-- rather than opening patient_docs' RLS to anon directly. RLS on
-- patient_docs stays staff-only; these functions bypass it deliberately
-- and re-validate everything by token.
alter table patient_docs add column public_token uuid not null default gen_random_uuid();
create unique index patient_docs_public_token_idx on patient_docs (public_token);

create or replace function get_public_patient_doc(p_token uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', d.title,
    'fields', d.fields,
    'completed_at', d.completed_at,
    'account_name', a.name
  )
  from patient_docs d
  join accounts a on a.id = d.account_id
  where d.public_token = p_token
$$;

revoke execute on function get_public_patient_doc(uuid) from public;
grant execute on function get_public_patient_doc(uuid) to anon, authenticated;

-- Locks server-side once completed_at is set -- the public page also hides
-- the form at that point, but the RPC is the actual enforcement so a
-- crafted request can't reopen a signed document via the same link.
create or replace function save_public_patient_doc(p_token uuid, p_fields jsonb, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz;
begin
  select completed_at into v_completed_at from patient_docs where public_token = p_token;
  if not found then
    raise exception 'Document not found';
  end if;
  if v_completed_at is not null then
    raise exception 'This document has already been completed';
  end if;

  update patient_docs
  set fields = p_fields,
      updated_at = now(),
      completed_at = case when p_complete then now() else completed_at end
  where public_token = p_token;
end;
$$;

revoke execute on function save_public_patient_doc(uuid, jsonb, boolean) from public;
grant execute on function save_public_patient_doc(uuid, jsonb, boolean) to anon, authenticated;
