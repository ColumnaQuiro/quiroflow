-- Records the completing patient's IP address alongside completed_at, same
-- as PracticeHub does on its own signed forms -- an audit trail for who
-- actually completed a consent form/signature, not just when.
--
-- save_public_patient_doc is called directly from the browser via
-- supabase.rpc(), with no Nuxt server hop in between (0055_public_patient_docs.sql),
-- so there's no request handler to read the caller's IP from. PostgREST
-- (Supabase's REST layer) exposes the original request's headers to
-- security definer functions via the request.headers GUC, which is the
-- standard way to get this without adding a server route just to proxy
-- the call.
alter table patient_docs add column completed_ip inet;

create or replace function save_public_patient_doc(p_token uuid, p_fields jsonb, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz;
  v_ip inet;
begin
  select completed_at into v_completed_at from patient_docs where public_token = p_token;
  if not found then
    raise exception 'Document not found';
  end if;
  if v_completed_at is not null then
    raise exception 'This document has already been completed';
  end if;

  if p_complete then
    begin
      v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  update patient_docs
  set fields = p_fields,
      updated_at = now(),
      completed_at = case when p_complete then now() else completed_at end,
      completed_ip = case when p_complete then v_ip else completed_ip end
  where public_token = p_token;
end;
$$;
