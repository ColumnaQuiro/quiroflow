-- patient_visit_facts() re-read every appointment of the clinic on every call.
--
-- It is what the recall queue, the parked recalls and the sidebar's recalls
-- badge are built on (20261003155100_recalls_read_every_visit.sql): per
-- patient, the last attended visit, the last no-show and whether anything is
-- booked ahead. It answered by aggregating appointments from scratch, so the
-- cost was the clinic's whole history whatever was asked -- the badge's count,
-- or `recall_candidates where patient_id = $1` for one patient's page:
--
--   Function Scan on patient_visit_facts f (actual time=120.741..121.584 rows=3043)
--     Buffers: shared hit=4590, temp read=343 written=344
--
-- 120 of that query's 146 ms, on production on 23 Nov 2026, and growing with
-- every visit a clinic has ever had. An index does not help: the largest
-- clinic is most of the table, and reading most of a table is a sequential
-- scan whichever index exists.
--
-- So the three dates are kept, one row per patient, and brought up to date by
-- the statements that change appointments. The function reads that table --
-- thousands of rows for a clinic rather than a hundred thousand -- and what
-- it returns, to whom, is unchanged.

-- table-grants-ok: patient_visit_stats: read only by the security-definer patient_visit_facts(), written only by the trigger below
create table public.patient_visit_stats (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- Appointments that are not deleted. A row stays when this reaches zero
  -- (see the refresh below for why), and patient_visit_facts() leaves it out,
  -- as it left out a patient with no appointments before.
  appointment_count integer not null default 0,
  -- Latest starts_at among those neither cancelled nor missed: "last visit",
  -- which is in the future when the patient is booked ahead.
  last_attended_at timestamptz,
  -- Latest starts_at among the missed.
  last_no_show_at timestamptz,
  -- Latest starts_at among those not cancelled. "Booked ahead" is this being
  -- later than now, which is why it is a date and not a boolean: it stops
  -- being true by itself as time passes, with no appointment changing.
  last_uncancelled_at timestamptz
);

create index patient_visit_stats_account_id_idx on public.patient_visit_stats (account_id);

-- No policy lets anyone read it: the function is the only way in, and it
-- applies the patient scoping itself. The two-factor policy is added all the
-- same, so that a policy added later cannot open it to a password alone.
alter table public.patient_visit_stats enable row level security;
select public.require_two_factor_on('public.patient_visit_stats');
-- (That call also attaches read_only_while_unpaid. It refuses nothing new:
-- the only writer is the trigger on appointments, and a caller it would
-- refuse here has already been refused there.)

-- This table has a patient_id and is deliberately NOT in merge_patients or
-- anonymize_patient. It holds nothing of its own: merging moves the
-- duplicate's appointments, which fires the trigger below for both patients,
-- and the duplicate's row goes with the duplicate. Anonymising keeps the
-- appointments, and these are their dates.

create or replace function public.patient_visit_stats_refresh(p_patient_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_patient_ids is null or cardinality(p_patient_ids) = 0 then
    return;
  end if;

  -- Two people changing the same patient's appointments at once would each
  -- aggregate without the other's change and the later write would lose it.
  -- So each refresh first holds the patient's row here, and aggregates in a
  -- statement of its own afterwards: under read committed that statement sees
  -- everything committed by whoever held the row before.
  --
  -- That is also why a row is never deleted when a patient's last appointment
  -- goes: a refresh waiting on a row that is then deleted would have nothing
  -- to update. And why the lock is this row and not an advisory lock per
  -- patient: a statement that touches thousands of patients would run the
  -- lock table out of memory; row locks are held in the rows.
  insert into public.patient_visit_stats (patient_id, account_id)
  select p.id, p.account_id
  from public.patients p
  where p.id = any (p_patient_ids)
  order by p.id
  on conflict (patient_id) do nothing;

  perform 1
  from public.patient_visit_stats s
  where s.patient_id = any (p_patient_ids)
  order by s.patient_id
  for update;

  update public.patient_visit_stats s
  set appointment_count = f.appointment_count,
      last_attended_at = f.last_attended_at,
      last_no_show_at = f.last_no_show_at,
      last_uncancelled_at = f.last_uncancelled_at
  from (
    select ids.patient_id,
           count(a.id)::integer as appointment_count,
           max(a.starts_at) filter (where a.status <> all (array['cancelled', 'no_show'])) as last_attended_at,
           max(a.starts_at) filter (where a.status = 'no_show') as last_no_show_at,
           max(a.starts_at) filter (where a.status <> 'cancelled') as last_uncancelled_at
    from (select distinct unnest(p_patient_ids) as patient_id) ids
    left join public.appointments a on a.patient_id = ids.patient_id and a.deleted_at is null
    group by ids.patient_id
  ) f
  where s.patient_id = f.patient_id
    and (s.appointment_count, s.last_attended_at, s.last_no_show_at, s.last_uncancelled_at)
        is distinct from (f.appointment_count, f.last_attended_at, f.last_no_show_at, f.last_uncancelled_at);
end;
$$;

revoke all on function public.patient_visit_stats_refresh(uuid[]) from public, anon, authenticated;

-- Once per statement, not per row: an importer inserts five hundred
-- appointments at a time, and the patients among them are refreshed together.
-- An update that changed none of the four columns the dates depend on -- most
-- of them: a note, a check-in, a reminder sent -- refreshes nothing.
create or replace function public.trg_patient_visit_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.patient_id) into v_ids from new_rows n where n.patient_id is not null;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.patient_id) into v_ids from old_rows o where o.patient_id is not null;
  else
    select array_agg(distinct x.patient_id) into v_ids
    from old_rows o
    join new_rows n on n.id = o.id
    cross join lateral (values (o.patient_id), (n.patient_id)) x (patient_id)
    where x.patient_id is not null
      and (o.patient_id, o.starts_at, o.status, o.deleted_at) is distinct from (n.patient_id, n.starts_at, n.status, n.deleted_at);
  end if;
  perform public.patient_visit_stats_refresh(v_ids);
  return null;
end;
$$;

create trigger patient_visit_stats_on_insert
  after insert on public.appointments
  referencing new table as new_rows
  for each statement execute function public.trg_patient_visit_stats();

create trigger patient_visit_stats_on_update
  after update on public.appointments
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.trg_patient_visit_stats();

create trigger patient_visit_stats_on_delete
  after delete on public.appointments
  referencing old table as old_rows
  for each statement execute function public.trg_patient_visit_stats();

-- What is already there. After the triggers exist, so nothing written from
-- here on is missed; a row a trigger has already written is the newer one.
insert into public.patient_visit_stats (patient_id, account_id, appointment_count, last_attended_at, last_no_show_at, last_uncancelled_at)
select p.id, p.account_id, count(a.id)::integer,
       max(a.starts_at) filter (where a.status <> all (array['cancelled', 'no_show'])),
       max(a.starts_at) filter (where a.status = 'no_show'),
       max(a.starts_at) filter (where a.status <> 'cancelled')
from public.appointments a
join public.patients p on p.id = a.patient_id
where a.deleted_at is null
group by p.id, p.account_id
on conflict (patient_id) do nothing;

-- Same signature, same rows, same checks -- the caller's own accounts, only
-- once two-factor is satisfied, and only patients they may see -- read from
-- the kept dates instead of from every appointment.
create or replace function public.patient_visit_facts()
returns table (patient_id uuid, last_appointment_at timestamptz, last_no_show_at timestamptz, has_future_appointment boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.patient_id,
         s.last_attended_at,
         s.last_no_show_at,
         coalesce(s.last_uncancelled_at > now(), false)
  from patient_visit_stats s
  where s.appointment_count > 0
    and s.account_id in (select my_member_account_ids())
    and (select mfa_satisfied())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and s.patient_id in (select my_own_patient_ids()))
    );
$function$;
