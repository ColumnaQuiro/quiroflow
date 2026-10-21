-- The change a cash drawer starts the day with ("el cambio"). The shift's
-- "Expected in drawer" was cash payments plus cash in minus cash out, so a
-- drawer opened with 100 EUR of change read 100 EUR short of what was in it,
-- every day, and the count at the end never matched.
--
-- Shifts open themselves at the start of each day (CashShiftModal.vue,
-- mobile/pages/cash.vue), and nobody counts the change at that moment. So a
-- new shift starts with the previous shift's float -- most clinics keep the
-- same change from one day to the next -- and the desk corrects it on the
-- shift when it differs. Done here rather than in the two clients that
-- insert shifts, so the web and the app cannot disagree about it.

alter table public.cash_shifts
  add column opening_float_cents integer not null default 0
    constraint cash_shifts_opening_float_not_negative check (opening_float_cents >= 0);

create or replace function public.cash_shift_carry_float()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only a shift opened without saying (both clients insert without it): an
  -- explicit float is kept as given.
  if new.opening_float_cents = 0 then
    new.opening_float_cents := coalesce(
      (select s.opening_float_cents
         from cash_shifts s
        where s.account_id = new.account_id
        order by s.opened_at desc
        limit 1),
      0);
  end if;
  return new;
end;
$$;

create trigger trg_cash_shift_carry_float
  before insert on public.cash_shifts
  for each row execute function public.cash_shift_carry_float();
