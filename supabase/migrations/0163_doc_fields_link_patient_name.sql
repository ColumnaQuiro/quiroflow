-- Let a doc field write back to the patient's name.
--
-- save_public_patient_doc matches DocField.patientField against a hardcoded
-- CASE rather than resolving a column from the request, because it is
-- callable by anon through a public token -- so the allowlist here is the
-- real gate, and utils/docFields.ts's LINKABLE_PATIENT_FIELDS only decides
-- what the builder offers. Adding a key to the TypeScript list alone would
-- give a field that prefills correctly and then silently discards whatever
-- the patient typed. 0151's own comment says to keep the two in sync by
-- hand; this is that.
--
-- first_name/last_name were left out of both on the grounds that a name is
-- a merge token rather than a question. An intake form asks for the name
-- first, so a form that collects one and cannot store it just leaves
-- reception retyping it.
--
-- Everything else is 0151 unchanged.
create or replace function save_public_patient_doc(p_token uuid, p_fields jsonb, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz;
  v_patient_id uuid;
  v_ip inet;
  v_field jsonb;
  v_key text;
  v_value text;
begin
  select completed_at, patient_id into v_completed_at, v_patient_id from patient_docs where public_token = p_token;
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

  if p_complete and v_patient_id is not null then
    for v_field in select jsonb_array_elements(p_fields) loop
      v_key := v_field->>'patientField';
      if v_key is null then
        continue;
      end if;
      v_value := v_field->>'value';
      if v_value is null or v_value = '' then
        continue;
      end if;

      case v_key
        -- first_name is NOT NULL on patients, and the empty-value guard
        -- above already skipped a blank, so this cannot null out a name.
        when 'first_name' then
          update patients set first_name = v_value where id = v_patient_id;
        when 'last_name' then
          update patients set last_name = v_value where id = v_patient_id;
        when 'date_of_birth' then
          begin
            update patients set date_of_birth = v_value::date where id = v_patient_id;
          exception when others then null;
          end;
        when 'email' then
          update patients set email = v_value where id = v_patient_id;
        when 'address' then
          update patients set address = v_value where id = v_patient_id;
        when 'city' then
          update patients set city = v_value where id = v_patient_id;
        when 'postal_code' then
          update patients set postal_code = v_value where id = v_patient_id;
        when 'country' then
          update patients set country = v_value where id = v_patient_id;
        when 'national_id' then
          update patients set national_id = v_value where id = v_patient_id;
        when 'occupation' then
          update patients set occupation = v_value where id = v_patient_id;
        when 'gender' then
          update patients set gender = v_value where id = v_patient_id;
        when 'emergency_contact' then
          update patients set emergency_contact = v_value where id = v_patient_id;
        else
          null;
      end case;
    end loop;
  end if;
end;
$$;
