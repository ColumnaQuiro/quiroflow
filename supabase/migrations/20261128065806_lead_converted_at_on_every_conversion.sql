-- leads.converted_at, set however a lead reaches Converted.
--
-- The Growth dashboard now counts conversions in the month they HAPPENED
-- (server/api/growth/dashboard.get.ts). It used to count only the leads that
-- both arrived and converted this month, and conversion here is usually a
-- returning visit three to five weeks after the enquiry -- so the current
-- month read 0 converted while five people had converted in it, all from the
-- month before.
--
-- Counting by date needs a date on every conversion, and only one path wrote
-- one: lead_auto_stage(), when the convert-after-visits rule fires. A lead
-- dragged to Converted on the board, moved there by an automation, or
-- inserted there by an importer had converted_at null, and would vanish from
-- the new count entirely. So the stage trigger stamps it, the first time a
-- lead reaches Converted, alongside furthest_stage.
--
-- First time only: coalesce keeps an existing date, so a lead moved back to
-- Showed to correct a mistake and then forward again is still counted in the
-- month it first converted -- the same forward-only reading furthest_stage
-- has.

create or replace function public.leads_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- INSERT as well as UPDATE: an importer or the receptionist can create a
  -- lead past 'new' (20260914095229_growth_dashboard_data.sql).
  if tg_op = 'INSERT' then
    if lead_stage_rank(new.stage) > lead_stage_rank(new.furthest_stage) then
      new.furthest_stage := new.stage;
    end if;
    if new.furthest_stage = 'converted' then
      new.converted_at := coalesce(new.converted_at, now());
    end if;
    return new;
  end if;

  new.updated_at := now();
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    -- Only ever moves forward. A lead dragged back from Booked to Contacted
    -- to correct a mistake has still been booked.
    if lead_stage_rank(new.stage) > lead_stage_rank(old.furthest_stage) then
      new.furthest_stage := new.stage;
    end if;
    if new.stage = 'converted' then
      new.converted_at := coalesce(new.converted_at, old.converted_at, now());
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.leads_touch_updated_at() from public, anon, authenticated;

-- The leads already in Converted without a date. stage_changed_at is the
-- best record there is of when they got there: for a lead still sitting in
-- Converted it is exactly that moment. (On 28 Nov 2026 production had none
-- of these -- every converted lead came through the visits rule -- so this
-- is for local and test databases as much as anything.)
update public.leads
   set converted_at = coalesce(stage_changed_at, created_at)
 where furthest_stage = 'converted'
   and converted_at is null;

-- The dashboard's new read: this month's conversions for one account.
create index if not exists leads_account_converted_at_idx
  on public.leads (account_id, converted_at)
  where deleted_at is null and converted_at is not null;
