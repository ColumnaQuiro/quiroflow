-- Pain 0-10 on every visit, so a patient's progress through a care plan is a
-- curve rather than a feeling: the practitioner taps it beside the visit note,
-- and the patient can give it themselves right after "Ya estoy aquí". Both
-- are kept; the practitioner's is the one that counts when there are two
-- (every reader takes coalesce(practitioner_score, patient_score)).
--
-- Keyed by appointment, like visit_listings, so the patient comes from the
-- visit and there is no patient_id here (merge_patients moves appointments,
-- which carries these). Staff access mirrors visit_notes: read with
-- visit_notes_access, change with visit_notes_edit, remove with
-- visit_notes_delete. Audited as part of the visit note, which is what it is.
create table public.visit_pain_scores (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  practitioner_score smallint check (practitioner_score between 0 and 10),
  practitioner_id uuid references public.team_members(id) on delete set null,
  practitioner_scored_at timestamptz,
  patient_score smallint check (patient_score between 0 and 10),
  patient_scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visit_pain_scores_account_id_idx on public.visit_pain_scores (account_id);
create index visit_pain_scores_practitioner_id_idx on public.visit_pain_scores (practitioner_id);

alter table public.visit_pain_scores enable row level security;

create policy "staff select visit_pain_scores" on public.visit_pain_scores for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
create policy "staff insert visit_pain_scores" on public.visit_pain_scores for insert
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
create policy "staff update visit_pain_scores" on public.visit_pain_scores for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit'));
create policy "staff delete visit_pain_scores" on public.visit_pain_scores for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_delete'));

select public.require_two_factor_on('public.visit_pain_scores');

create trigger trg_audit_visit_pain_scores
  after insert or update or delete on public.visit_pain_scores
  for each row execute function public.fn_audit_log('visit_note');

-- The patient's side: their own visit only, from 90 minutes before it until
-- the end of that day -- so it is given on arrival or just after, never from
-- home a week later. Returns false when there is nothing to score.
create or replace function public.set_my_pain_score(p_appointment_id uuid, p_score smallint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'Pain is scored from 0 to 10';
  end if;
  select a.account_id into v_account
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.id = p_appointment_id
    and p.user_id = auth.uid()
    and a.status in ('booked', 'completed')
    and a.deleted_at is null
    and now() >= a.starts_at - interval '90 minutes'
    and now() < date_trunc('day', a.ends_at) + interval '1 day';
  if v_account is null then
    return false;
  end if;
  insert into public.visit_pain_scores (account_id, appointment_id, patient_score, patient_scored_at)
  values (v_account, p_appointment_id, p_score, now())
  on conflict (appointment_id) do update
    set patient_score = excluded.patient_score, patient_scored_at = now(), updated_at = now();
  return true;
end;
$$;

revoke all on function public.set_my_pain_score(uuid, smallint) from public, anon;
grant execute on function public.set_my_pain_score(uuid, smallint) to authenticated;

-- What the patient sees beside the question: what they gave today (if they
-- already did), and the score of their previous scored visit and of their
-- first, so "3, and 7 when you started" is there without them having to
-- remember. Their own visits only; the practitioner's score wins, as above.
create or replace function public.my_pain_context(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_starts timestamptz;
  v_today smallint;
  v_previous smallint;
  v_first smallint;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  select a.patient_id, a.starts_at into v_patient, v_starts
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.id = p_appointment_id and p.user_id = auth.uid() and a.deleted_at is null;
  if v_patient is null then
    return null;
  end if;
  select s.patient_score into v_today from public.visit_pain_scores s where s.appointment_id = p_appointment_id;
  select coalesce(s.practitioner_score, s.patient_score) into v_previous
  from public.visit_pain_scores s
  join public.appointments a on a.id = s.appointment_id
  where a.patient_id = v_patient and a.starts_at < v_starts and a.deleted_at is null
    and coalesce(s.practitioner_score, s.patient_score) is not null
  order by a.starts_at desc limit 1;
  select coalesce(s.practitioner_score, s.patient_score) into v_first
  from public.visit_pain_scores s
  join public.appointments a on a.id = s.appointment_id
  where a.patient_id = v_patient and a.starts_at < v_starts and a.deleted_at is null
    and coalesce(s.practitioner_score, s.patient_score) is not null
  order by a.starts_at asc limit 1;
  return jsonb_build_object('today', v_today, 'previous', v_previous, 'first', v_first);
end;
$$;

revoke all on function public.my_pain_context(uuid) from public, anon;
grant execute on function public.my_pain_context(uuid) to authenticated;
