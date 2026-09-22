-- Fall back to the template's link when a doc's own snapshot hasn't got one.
--
-- A patient_docs row copies the template's fields at the moment the doc is
-- rendered. So linking a template field to a patient column (DocField
-- .patientField, see utils/docFields.ts) only affects docs rendered after
-- that -- every doc already sent out keeps the unlinked copy it was made
-- with, and completing it writes nothing back.
--
-- That is not hypothetical. The four Spanish intake/consent templates were
-- linked to national_id after they had already been sent to patients, so 16
-- patients completed a form with their DNI in it and kept an empty
-- national_id. Tomas Berenguer filled his in three separate documents on
-- 2026-09-07 and none of them reached his record. Those 16 have been
-- backfilled by hand; this is what stops the next ones happening, including
-- the 10 docs that were still outstanding when this was written.
--
-- The snapshot still wins where it has a value: an explicit link recorded at
-- render time is a deliberate statement about that doc, and a template that
-- has since been *un*linked shouldn't retroactively silence a doc that was
-- sent while the link existed. This only fills the gap where the snapshot
-- says nothing at all.
--
-- On the security property this function is built around: it is callable by
-- anon through a public token, which is why the column is matched against a
-- hardcoded CASE rather than resolved from the request. That is unchanged.
-- The fallback reads patientField from doc_templates -- server-side data
-- written by an authenticated staff member -- and feeds it through the same
-- allowlist. Nothing new reaches the CASE from the caller.
--
-- The tradeoff: a template field that is re-purposed in place (same field id,
-- new question, newly linked to a different column) would let an old doc's
-- answer to the old question land on that column. Field ids are per-field
-- UUIDs, so this needs someone to edit a question's text and link rather than
-- replace the field, and it is worth accepting to stop silently dropping the
-- answers patients have already given.
--
-- Everything else is 0163 unchanged.
create or replace function save_public_patient_doc(p_token uuid, p_fields jsonb, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz;
  v_patient_id uuid;
  v_template_id uuid;
  v_ip inet;
  v_field jsonb;
  v_key text;
  v_value text;
begin
  select completed_at, patient_id, template_id
    into v_completed_at, v_patient_id, v_template_id
  from patient_docs where public_token = p_token;
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

      -- The snapshot said nothing, so ask the template this doc came from.
      -- Matched on the field's own id, not its position or label, so
      -- reordering or renaming the other questions can't shift the answer
      -- onto the wrong column.
      if v_key is null and v_template_id is not null and v_field->>'id' is not null then
        select tf->>'patientField'
          into v_key
        from doc_templates t
        cross join lateral jsonb_array_elements(t.fields) tf
        where t.id = v_template_id
          and tf->>'id' = v_field->>'id'
        limit 1;
      end if;

      if v_key is null then
        continue;
      end if;

      -- Trimmed, and the blank check is against the trimmed value. 0163
      -- compared the raw string to '' , so an answer of "   " passed the
      -- guard and wrote three spaces onto the column -- a whitespace
      -- national_id reads as filled in everywhere that checks for one, and a
      -- leading space on a name survives into invoices and merge tokens.
      -- Pre-existing, found while testing this change, and one line inside a
      -- function already being replaced.
      v_value := btrim(coalesce(v_field->>'value', ''));
      if v_value = '' then
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
