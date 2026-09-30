-- Two things about membership plans, from the settings QA round (30 Sep 2026).
--
-- 1. A member keeps the period they signed up on. Existing members read the
--    PLAN's billing_interval live, so editing a plan from monthly to yearly
--    re-stated every current member's autopay default and "recurring each
--    month" total, though nothing about what they pay had changed. Each
--    patient_memberships row now carries its own copy, taken when it is
--    created, and existing rows are given their plan's current period -- the
--    best record there is of what they signed up to.
alter table public.patient_memberships
  add column billing_interval text,
  add column billing_interval_count integer;

update public.patient_memberships pm
set billing_interval = m.billing_interval,
    billing_interval_count = m.billing_interval_count
from public.memberships m
where m.id = pm.membership_id and pm.billing_interval is null;

create or replace function public.patient_membership_takes_plan_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.billing_interval is null and new.membership_id is not null then
    select m.billing_interval, m.billing_interval_count
      into new.billing_interval, new.billing_interval_count
      from public.memberships m
     where m.id = new.membership_id;
  end if;
  return new;
end;
$$;

revoke all on function public.patient_membership_takes_plan_period() from public, anon, authenticated;

create trigger patient_membership_takes_plan_period
  before insert on public.patient_memberships
  for each row execute function public.patient_membership_takes_plan_period();

-- 2. A plan an automation filters on cannot be deleted. Deleting it sets
--    membership_id to null on its members, so a rule or segment filtering on
--    that plan's id went on running and quietly matched nobody. The delete
--    is refused, naming the automations, so the filter is changed first.
create or replace function public.guard_membership_in_automations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text;
begin
  select string_agg(distinct r.name, ', ')
    into v_names
    from public.automation_rules r
   where r.account_id = old.account_id
     and (
       r.filters::text like '%' || old.id::text || '%'
       or r.segment::text like '%' || old.id::text || '%'
       or exists (
         select 1 from public.automation_actions a
          where a.rule_id = r.id and a.config::text like '%' || old.id::text || '%'
       )
     );
  if v_names is not null then
    raise exception using
      errcode = '23503',
      message = format('This plan is used by the automations %s. Take it out of them first; deleted, they would quietly match nobody.', v_names);
  end if;
  return old;
end;
$$;

revoke all on function public.guard_membership_in_automations() from public, anon, authenticated;

create trigger guard_membership_in_automations
  before delete on public.memberships
  for each row execute function public.guard_membership_in_automations();
