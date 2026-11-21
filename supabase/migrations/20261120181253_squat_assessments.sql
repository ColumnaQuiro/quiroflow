-- Squat assessments, kept beside posture ones: two photos per angle -- the
-- patient standing ("arriba") and at the lowest point of a squat ("abajo") --
-- from the front, the side or both, points placed and dragged exactly as for
-- posture, and what is measured from them (utils/squat.ts).
--
-- Same table, told apart by `kind`, so a squat has everything a posture
-- assessment already has without a line of it repeated: its policies and
-- two-factor guard, its place in merge_patients and anonymize_patient, its
-- photos' storage and their removal with the patient. Every row written
-- before this is a posture assessment, which the default says.
--
-- views and metrics hold the squat's photos under their own keys
-- (front_up, front_down, side_up, side_down) rather than front/right/back/
-- left, so nothing that reads a posture assessment's views finds one of
-- them by accident. What reads posture rows filters on kind as well.

alter table public.posture_assessments
  add column if not exists kind text not null default 'posture';

alter table public.posture_assessments
  drop constraint if exists posture_assessments_kind_check;
alter table public.posture_assessments
  add constraint posture_assessments_kind_check check (kind in ('posture', 'squat'));

create index if not exists posture_assessments_patient_kind on public.posture_assessments (patient_id, kind, taken_at);

-- A comparison sent to the patient (posture_comparisons) is two posture
-- assessments read together: its PDF and the patient's screen know only
-- posture measurements. The API refuses anything else; this is the floor
-- under it for a write that does not go through the API.
create or replace function public.posture_comparisons_posture_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from posture_assessments
    where id in (new.before_assessment_id, new.after_assessment_id) and kind <> 'posture'
  ) then
    raise exception 'Only posture assessments can be compared and sent'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posture_comparisons_posture_only on public.posture_comparisons;
create trigger trg_posture_comparisons_posture_only
  before insert or update of before_assessment_id, after_assessment_id on public.posture_comparisons
  for each row execute function public.posture_comparisons_posture_only();
