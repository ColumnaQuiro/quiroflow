-- Two-way sync between a doc's interactive fields and the patient record:
-- a field can be linked to a patient column (DocField.patientField, see
-- utils/docFields.ts LINKABLE_PATIENT_FIELDS) so that filling it in on the
-- public form and submitting (p_complete = true) writes that value back
-- onto the patient row, the same way the client already prefills it from
-- the patient's existing data before the form is opened.
--
-- Runs inside save_public_patient_doc (0055_public_patient_docs.sql,
-- extended in 0082_patient_doc_completion_ip.sql) since that's the only
-- write path an anonymous, unauthenticated patient link goes through. It
-- is callable by anon, so the column to update can never come from the
-- request itself -- only these ten hardcoded keys, matched by a CASE
-- statement, are ever written. Keep this list in sync by hand with
-- LINKABLE_PATIENT_FIELDS in utils/docFields.ts.
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
