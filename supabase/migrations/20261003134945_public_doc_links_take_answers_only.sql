-- A public document link carries the patient's ANSWERS, never the document.
--
-- /doc/<token> is reached with no sign-in, and both functions below are
-- security definer and granted to anon (0055). Whoever holds the link -- the
-- patient, or anybody the WhatsApp or email was forwarded to -- could do three
-- things the clinic never offered:
--
-- 1. Rewrite the document. save_public_patient_doc stored the caller's whole
--    `fields` array (`set fields = p_fields`), so the label of a text block --
--    the consent wording itself -- could be replaced and saved as signed. Now
--    the stored document is the definition: its blocks, their order, labels,
--    types, options and column links all stay exactly as the clinic sent them,
--    and the caller contributes only `value`, matched to a block by its id.
--    Blocks the caller invents are dropped; static blocks (heading/text) take
--    no value at all. A value has to be a string, number, boolean, null or a
--    list of strings -- an object is not an answer to anything.
--
-- 2. Choose which patient column an answer writes. `v_key := v_field->>
--    'patientField'` read the column from the caller's JSON, so adding
--    patientField: 'email' to any answer overwrote patients.email -- the key
--    the patient app claims a record by (claim_patient_profile, 0086) and
--    online booking matches on. The column now comes only from the stored
--    block, or from its template as 20260914181550 already did; both are
--    written by signed-in staff. And the values are checked before they reach
--    the record:
--      - email: has to look like an address, is stored lower-case, and only
--        FILLS a blank one. An address already on file is never replaced from
--        a link -- that is an identity change, and it is the clinic's to make.
--      - date_of_birth: has to be a real date between 1900 and today.
--      - national_id, postal_code: letters, digits and the usual separators.
--      - everything: trimmed, length-capped, and single-line fields refuse
--        control characters.
--    A value that fails is not an error -- the patient's submission still
--    goes through and the answer is kept in the document for the clinic to
--    read. It just does not reach the record.
--    There is no phone column in the allowlist (utils/docFields.ts says why),
--    so there is no phone to validate here.
--
-- 3. Read the answers back. get_public_patient_doc returned `fields` -- DNI,
--    signature, health answers -- for any token, for ever. Once the form is
--    completed it now returns only that it is completed: `fields` is an empty
--    list and `title` null. The page (pages/doc/[token].vue) already shows
--    the thank-you for a completed form and nothing else, so the live page
--    keeps working unchanged. Staff read completed documents through RLS on
--    patient_docs, which this does not touch. A document staff reopen
--    (DocsTab clears completed_at) is readable through its link again, as
--    it should be.
--
--    Unsigned links still do not expire: there is no setting for how long a
--    link should live, and an arbitrary cut-off would strand patients who
--    open the WhatsApp a week later.
--
-- Backwards compatible with the live page: signatures, return shapes,
-- security definer and search_path are unchanged. The page sends every block
-- whole with its answer filled in; that still works, the extra keys are simply
-- not trusted.

create or replace function get_public_patient_doc(p_token uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', case when d.completed_at is null then d.title end,
    'fields', case when d.completed_at is null then d.fields else '[]'::jsonb end,
    'completed_at', d.completed_at,
    'account_name', a.name
  )
  from patient_docs d
  join accounts a on a.id = d.account_id
  where d.public_token = p_token
$$;

revoke execute on function get_public_patient_doc(uuid) from public;
grant execute on function get_public_patient_doc(uuid) to anon, authenticated;

create or replace function save_public_patient_doc(p_token uuid, p_fields jsonb, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_completed_at timestamptz;
  v_patient_id uuid;
  v_template_id uuid;
  v_stored jsonb;
  v_given jsonb;
  v_fields jsonb;
  v_ip inet;
  v_field jsonb;
  v_key text;
  v_value text;
  v_date date;
begin
  -- FOR UPDATE: two submissions of the same link a moment apart would both
  -- see completed_at null otherwise, and the second would overwrite the first.
  select id, completed_at, patient_id, template_id, fields
    into v_doc_id, v_completed_at, v_patient_id, v_template_id, v_stored
  from patient_docs where public_token = p_token
  for update;
  if not found then
    raise exception 'Document not found';
  end if;
  if v_completed_at is not null then
    raise exception 'This document has already been completed';
  end if;

  if jsonb_typeof(v_stored) is distinct from 'array' then
    v_stored := '[]'::jsonb;
  end if;
  v_given := case when jsonb_typeof(p_fields) = 'array' then p_fields else '[]'::jsonb end;

  -- The stored blocks, in their stored order, each with the caller's answer
  -- for it if one was given and is an answer at all. Matched on the block's
  -- id; a block stored without one (nothing in the app writes those, but a
  -- hand-made import could) is matched by position, and only to a block that
  -- has no id either.
  select coalesce(jsonb_agg(
           case
             when s.f->>'type' in ('heading', 'text') then s.f
             when a.v is null then s.f
             when jsonb_typeof(a.v) in ('string', 'number', 'boolean', 'null') then jsonb_set(s.f, '{value}', a.v)
             when jsonb_typeof(a.v) = 'array'
                  and not exists (select 1 from jsonb_array_elements(a.v) e where jsonb_typeof(e) <> 'string')
               then jsonb_set(s.f, '{value}', a.v)
             else s.f
           end
           order by s.ord), '[]'::jsonb)
    into v_fields
  from jsonb_array_elements(v_stored) with ordinality as s(f, ord)
  left join lateral (
    select g.f->'value' as v
    from jsonb_array_elements(v_given) with ordinality as g(f, ord)
    where case
            when s.f->>'id' is not null then g.f->>'id' = s.f->>'id'
            else g.ord = s.ord and g.f->>'id' is null
          end
    limit 1
  ) a on true;

  if p_complete then
    begin
      v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)::inet;
    exception when others then
      v_ip := null;
    end;
  end if;

  update patient_docs
  set fields = v_fields,
      updated_at = now(),
      completed_at = case when p_complete then now() else completed_at end,
      completed_ip = case when p_complete then v_ip else completed_ip end
  where id = v_doc_id;

  if p_complete and v_patient_id is not null then
    -- v_fields, not p_fields: the definitions are the stored ones, so the
    -- column link below is the clinic's and never the caller's.
    for v_field in select jsonb_array_elements(v_fields) loop
      -- Only the block types a link is offered for (LINKABLE_FIELD_TYPES),
      -- and only a text answer.
      if coalesce(v_field->>'type', '') not in ('short_text', 'long_text', 'date') then
        continue;
      end if;
      if jsonb_typeof(v_field->'value') is distinct from 'string' then
        continue;
      end if;

      v_key := v_field->>'patientField';

      -- The snapshot said nothing, so ask the template this doc came from
      -- (20260914181550). Server-side data, written by staff.
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

      v_value := btrim(v_field->>'value');
      if v_value = '' then
        continue;
      end if;

      -- Length caps, and no control characters on a single-line column: a
      -- newline in a surname survives into invoices and merge tokens.
      if length(v_value) > (case when v_key in ('address', 'emergency_contact') then 300 else 120 end) then
        continue;
      end if;
      if v_key not in ('address', 'emergency_contact') and v_value ~ '[[:cntrl:]]' then
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
            v_date := v_value::date;
          exception when others then
            v_date := null;
          end;
          if v_date between date '1900-01-01' and current_date then
            update patients set date_of_birth = v_date where id = v_patient_id;
          end if;
        when 'email' then
          -- Fills a blank address, never replaces one: see 2. above.
          v_value := lower(v_value);
          if v_value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
            update patients set email = v_value
            where id = v_patient_id and (email is null or btrim(email) = '');
          end if;
        when 'address' then
          update patients set address = v_value where id = v_patient_id;
        when 'city' then
          update patients set city = v_value where id = v_patient_id;
        when 'postal_code' then
          if v_value ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$' then
            update patients set postal_code = v_value where id = v_patient_id;
          end if;
        when 'country' then
          update patients set country = v_value where id = v_patient_id;
        when 'national_id' then
          -- A DNI, NIE or a foreign passport number: letters and digits, with
          -- the separators people type. Not a checksum test -- a passport has
          -- none, and refusing a real document number is worse than keeping
          -- a typo the clinic can see in the form.
          if v_value ~ '^[A-Za-z0-9][A-Za-z0-9 .-]{3,19}$' then
            update patients set national_id = v_value where id = v_patient_id;
          end if;
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

revoke execute on function save_public_patient_doc(uuid, jsonb, boolean) from public;
grant execute on function save_public_patient_doc(uuid, jsonb, boolean) to anon, authenticated;
