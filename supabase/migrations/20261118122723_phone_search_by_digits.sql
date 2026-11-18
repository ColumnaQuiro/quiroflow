-- Searching a patient by phone finds them however the number was written.
--
-- phone_search (20261020063000) held each number exactly as stored, and the
-- search matched what was typed against it character for character. Most
-- numbers are stored with spaces ("612 34 56 78"), so pasting the same number
-- as "612345678", or as "+34 612 34 56 78" from WhatsApp, found nobody: at one
-- clinic 213 of 272 numbers could not be found by pasting their digits.
--
-- Both sides are now digits: phone_search keeps each number as its digits,
-- space-separated between numbers (which is what utils/gocardlessMatch.ts
-- already assumed, and why it could not match a spaced number either), and
-- patients_matching turns a search that is only a phone number into its
-- digits before matching.
--
-- Compatible with the code that is live until the next release: it searches
-- phone_search with each typed word, and a run of digits still matches.

create or replace function fn_sync_patient_phone_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A number can move between patients (merge_patients), so both ends.
  for v_id in
    select distinct x from unnest(array[
      case when TG_OP <> 'INSERT' then OLD.patient_id end,
      case when TG_OP <> 'DELETE' then NEW.patient_id end
    ]) as x where x is not null
  loop
    -- Only when it changed, so a resave of a number does not fire the
    -- patient.updated webhook for nothing.
    update patients p
    set phone_search = s.numbers
    from (
      select string_agg(nullif(regexp_replace(n.number, '[^0-9]', '', 'g'), ''), ' ') as numbers
      from patient_contact_numbers n where n.patient_id = v_id
    ) s
    where p.id = v_id
      and p.phone_search is distinct from s.numbers;
  end loop;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function fn_sync_patient_phone_search() from public, anon, authenticated;

-- Backfill without telling every webhook subscriber that every patient with a
-- phone was "updated". The activity log already ignores phone_search.
alter table patients disable trigger trg_webhook_patient_updated;
update patients p
set phone_search = s.numbers
from (
  select patient_id, string_agg(nullif(regexp_replace(number, '[^0-9]', '', 'g'), ''), ' ') as numbers
  from patient_contact_numbers
  group by patient_id
) s
where s.patient_id = p.id
  and p.phone_search is distinct from s.numbers;
alter table patients enable trigger trg_webhook_patient_updated;

-- patients_matching, restated from 20261109181443_exercises_section_and_patient_types
-- with a phone-number search reduced to its digits. The next migration that
-- restates it must start from this one.
create or replace function public.patients_matching(p_filters jsonb default '{}'::jsonb, p_clinic_id uuid default null)
returns setof public.patients
language plpgsql
stable
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  w text[] := array[]::text[];
  v_status text := coalesce(nullif(f->>'status', ''), 'active');
  v_clinic text := nullif(f->>'clinic', '');
  v_clinic_id uuid;
  v_tz text;
  v_tags text[];
  v_token text;
  v_q text := btrim(coalesce(f->>'q', ''));
  v_like text;
  v_last_visit text := '(select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status = ''completed'' and a.deleted_at is null)';
  v_bono_left text := '(select coalesce(sum(pp.sessions_total - pp.sessions_used), 0) from package_purchases pp'
    || ' where not pp.is_closed and pp.sessions_used < pp.sessions_total'
    || ' and pp.id in (select o.id from package_purchases o where o.patient_id = p.id'
    || ' union all select s.package_purchase_id from package_purchase_shares s where s.patient_id = p.id))';
begin
  -- Which clinic. The sidebar's clinic unless the filter names another, or
  -- 'all' for every clinic the person can see.
  if v_clinic is null then
    v_clinic_id := p_clinic_id;
  elsif v_clinic <> 'all' then
    v_clinic_id := v_clinic::uuid;
  end if;
  if v_clinic_id is not null then
    w := w || format('p.clinic_id = %L', v_clinic_id);
  end if;
  select c.timezone into v_tz from clinics c where c.id = coalesce(v_clinic_id, p_clinic_id);
  v_tz := coalesce(nullif(v_tz, ''), 'Europe/Madrid');

  if v_status in ('active', 'inactive') then
    w := w || format('p.status = %L', v_status);
  end if;

  if nullif(f->>'practitioner', '') is not null then
    w := w || format('p.default_practitioner_id = %L', (f->>'practitioner')::uuid);
  end if;

  if jsonb_typeof(f->'tags') = 'array' then
    select array_agg(t) into v_tags from jsonb_array_elements_text(f->'tags') t where t <> '';
    if v_tags is not null then
      w := w || format('p.tags @> %L::text[]', v_tags);
    end if;
  end if;

  if nullif(f->>'lastVisitFrom', '') is not null then
    w := w || format('%s >= (%L::date)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitFrom')::date, v_tz);
  end if;
  if nullif(f->>'lastVisitTo', '') is not null then
    w := w || format('%s < ((%L::date) + 1)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitTo')::date, v_tz);
  end if;

  -- Same definition as the list's Next visit column (patient_list_visit_summary).
  if f->>'futureAppointment' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from appointments a where a.patient_id = p.id and a.status = ''booked'' and a.starts_at > now() and a.deleted_at is null)',
      case when f->>'futureAppointment' = 'no' then 'not' else '' end
    );
  end if;

  -- A live bono is what the Billing tab offers sessions from: own or shared,
  -- not closed in PracticeHub (20260923120702), with sessions left.
  if f->>'bono' = 'active' then
    w := w || format('%s > 0', v_bono_left);
    if nullif(f->>'bonoSessionsMax', '') is not null then
      w := w || format('%s <= %s', v_bono_left, greatest((f->>'bonoSessionsMax')::int, 0));
    end if;
  elsif f->>'bono' = 'none' then
    w := w || format('%s = 0', v_bono_left);
  end if;

  -- Owing asks the invoices, In credit the balance -- two different columns
  -- on purpose; see 20260923160000 and utils/owing.ts. Read from the view as
  -- one set, not through live_outstanding_cents(p) per row: on 3,300
  -- patients the computed field took 7.6 s (the view recomputed once per
  -- patient) and the set 80 ms. Same view, same RLS, same numbers.
  if f->>'balance' = 'owing' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.outstanding_cents > 0)'::text;
  elsif f->>'balance' = 'credit' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.balance_cents > 0)'::text;
  end if;

  if nullif(f->>'createdFrom', '') is not null then
    w := w || format('p.created_at >= (%L::date)::timestamp at time zone %L', (f->>'createdFrom')::date, v_tz);
  end if;
  if nullif(f->>'createdTo', '') is not null then
    w := w || format('p.created_at < ((%L::date) + 1)::timestamp at time zone %L', (f->>'createdTo')::date, v_tz);
  end if;

  -- What the patient banner calls "has the app" (components/patients/AppStatus.vue).
  if f->>'app' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from app_opens o where o.account_id = p.account_id and o.user_id = p.user_id)',
      case when f->>'app' = 'no' then 'not' else '' end
    );
  end if;

  if f->>'birthdayThisMonth' = 'true' then
    w := w || format('extract(month from p.date_of_birth) = extract(month from now() at time zone %L)', v_tz);
  end if;

  if f->>'carePlan' = 'on' then
    w := w || 'exists (select 1 from care_plans cp where cp.patient_id = p.id)'::text;
  end if;

  if f->>'missingContact' = 'email' then
    w := w || '(p.email is null or p.email = '''')'::text;
  elsif f->>'missingContact' = 'phone' then
    w := w || 'not p.has_phone'::text;
  end if;

  if f->>'doNotContact' = 'true' then
    w := w || 'p.do_not_contact'::text;
  end if;
  if f->>'minors' = 'true' then
    w := w || 'p.is_minor'::text;
  end if;

  -- On a list, or not on one (patient_list_members). Read under the caller's
  -- RLS like everything else here, so a private list someone else made
  -- matches nobody rather than leaking who is on it.
  if nullif(f->>'list', '') is not null then
    w := w || format('p.id in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'list')::uuid);
  end if;
  if nullif(f->>'notList', '') is not null then
    w := w || format('p.id not in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'notList')::uuid);
  end if;

  -- Family on the record (patient_relations, 20261021171628). 'linked' is
  -- anyone at all, 'none' nobody; a relation names what the OTHER person is
  -- to this one, as the table reads -- 'child' is "has a child on file",
  -- which is how a segment of parents is asked for.
  if f->>'family' = 'linked' then
    w := w || 'exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' = 'none' then
    w := w || 'not exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' in ('parent', 'child', 'partner', 'sibling') then
    w := w || format('exists (select 1 from patient_relations r where r.patient_id = p.id and r.relation = %L)', f->>'family');
  end if;

  -- Shares a bono with somebody, either way round: the bono-sharing graph
  -- that pools a family's money (package_share_edges, 20260923165911).
  if f->>'familyBono' = 'true' then
    w := w || 'exists (select 1 from package_share_edges e where e.a = p.id)'::text;
  end if;

  -- Marketing consent as stored: a channel present in marketing_channels.
  -- A withdrawn channel is its absence (20260930141326).
  if f->>'marketing' in ('email', 'whatsapp') then
    w := w || format('%L = any (p.marketing_channels)', f->>'marketing');
  elsif f->>'marketing' = 'any' then
    w := w || 'cardinality(p.marketing_channels) > 0'::text;
  elsif f->>'marketing' = 'none' then
    w := w || 'cardinality(p.marketing_channels) = 0'::text;
  end if;

  -- Patient types (patient_type_members): any of the ones named.
  if jsonb_typeof(f->'types') = 'array' and jsonb_array_length(f->'types') > 0 then
    w := w || format('p.id in (select tm.patient_id from patient_type_members tm where tm.type_id = any (%L::uuid[]))',
      (select array_agg(x::uuid) from jsonb_array_elements_text(f->'types') x));
  end if;

  -- Home exercises (the Exercises section): any on, none on, or on but
  -- ticked on fewer than three of the last seven days.
  if f->>'exercises' = 'yes' then
    w := w || 'exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'::text;
  elsif f->>'exercises' = 'no' then
    w := w || 'not exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'::text;
  elsif f->>'exercises' = 'low' then
    w := w || ('exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'
      || ' and (select count(distinct l.done_on) from patient_exercise_logs l join patient_exercises pe on pe.id = l.patient_exercise_id'
      || ' where pe.patient_id = p.id and l.done_on > current_date - 7) < 3')::text;
  end if;

  -- A search that is only a phone number becomes its digits, the form
  -- phone_search keeps, so "612 34 56 78", "612345678", "+34 612 345 678" and
  -- "(555) 123-4567" all find the number however it was typed or stored.
  -- Longer than nine digits keeps the last nine: that drops a +34 / 0034
  -- prefix, and stays a substring of any longer number stored with one.
  if v_q ~ '^[0-9[:space:]+()./-]+$' and v_q ~ '[0-9]' then
    v_q := regexp_replace(v_q, '[^0-9]', '', 'g');
    if length(v_q) > 9 then
      v_q := right(v_q, 9);
    end if;
  end if;

  -- Every word must match one of the four, as the list's search always has.
  -- LIKE's own wildcards and escape are taken out of what was typed.
  for v_token in
    select regexp_replace(x, '[%_\\,()]', '', 'g') from regexp_split_to_table(v_q, '\s+') x
  loop
    continue when v_token = '';
    v_like := '%' || v_token || '%';
    w := w || format(
      '(p.search_name ilike %L or p.email ilike %L or p.national_id ilike %L or p.phone_search ilike %L)',
      '%' || unaccent_lower(v_token) || '%', v_like, v_like, v_like
    );
  end loop;

  return query execute 'select p.* from patients p where '
    || coalesce(nullif(array_to_string(w, ' and '), ''), 'true');
end;
$$;

