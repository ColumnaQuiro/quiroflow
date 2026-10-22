-- What the app's home-screen widget shows, in one call (utils/homeWidget.ts,
-- mobile/composables/useHomeWidget.ts). The widget itself never talks to the
-- server: the app calls this when it opens, comes back to the foreground or
-- changes something the widget shows, and hands the native widget a snapshot.
--
-- The content depends on who is asking, decided here rather than in the app:
--
--   'clinic' -- an owner: money taken this month, visits done of booked
--               today, bonos sold this month. Owners only, deliberately not
--               "whoever sees money on the web dashboard": the seeded Front
--               Desk role has dashboard_scope 'all' + billing_access +
--               billing_history_view, so that rule would put the clinic's
--               takings on a receptionist's home screen.
--   'day'    -- a practitioner: their own visits today, as before.
--   'desk'   -- anyone else who sees the whole calendar (the front desk): the
--               clinic's visits today, with whom each one is.
--   'none'   -- nobody's day to show.
--
-- The money gate is HERE, not left to RLS. The payments select policy (0170)
-- admits any member with all-patients scope, which is most front desk roles,
-- so a security invoker function that summed payments for everyone would
-- hand them the clinic's takings. Only the 'clinic' view computes the money,
-- and every other view's result has no money keys at all.
--
-- Security invoker, so RLS and the "two factor when required" policies apply
-- to every read below. Under a pending second factor those reads come back
-- empty, and the app would write a widget full of zeros, so it refuses
-- instead.
--
-- The figures follow the web's definitions, so the widget says what the
-- dashboard says:
--   payments -- IncomeMiniWidget's "Paid": paid_at in the month, not 'credit'
--               or 'write_off' (utils/paymentReceipts.ts), not against a void
--               invoice. Refunds are negative receipts and net out.
--   visits   -- Visit summary: done = completed, total = booked + completed,
--               not deleted. No-shows are counted on their own.
--   bonos    -- Reports' "Bonos sold" / "Bono sales (EUR)": package_purchases
--               by purchased_at.
-- Day and month are the clinic's, in p_time_zone (clinics.timezone).
create or replace function public.get_home_widget(p_account_id uuid, p_time_zone text default 'Europe/Madrid')
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_tz text := coalesce(nullif(p_time_zone, ''), 'Europe/Madrid');
  v_me team_members;
  v_view text;
  v_today date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_month_start timestamptz;
  v_figures jsonb;
  v_day jsonb;
  v_own boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;

  select * into v_me from team_members
   where account_id = p_account_id and user_id = auth.uid() and deleted_at is null;
  if v_me.id is null then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Madrid';
  end if;
  v_today := (now() at time zone v_tz)::date;
  v_day_start := v_today::timestamp at time zone v_tz;
  v_day_end := (v_today + 1)::timestamp at time zone v_tz;
  v_month_start := date_trunc('month', v_today)::timestamp at time zone v_tz;

  v_view := case
    when v_me.is_owner then 'clinic'
    when v_me.is_practitioner then 'day'
    when public.permission_scope(p_account_id, 'calendar_scope') = 'all' then 'desk'
    else 'none'
  end;

  if v_view = 'clinic' then
    select jsonb_build_object(
      'payments_cents', (
        select coalesce(sum(p.amount_cents), 0)
          from payments p
          left join invoices i on i.id = p.invoice_id
         where p.account_id = p_account_id
           and p.paid_at >= v_month_start and p.paid_at < v_day_end
           and p.method not in ('credit', 'write_off')
           and coalesce(i.status, '') <> 'void'
      ),
      'visits_done', count(*) filter (where a.status = 'completed'),
      'visits_total', count(*) filter (where a.status in ('booked', 'completed')),
      'no_shows', count(*) filter (where a.status = 'no_show'),
      'bonos_count', (
        select count(*) from package_purchases b
         where b.account_id = p_account_id and b.purchased_at >= v_month_start and b.purchased_at < v_day_end
      ),
      'bonos_cents', (
        select coalesce(sum(b.price_cents), 0) from package_purchases b
         where b.account_id = p_account_id and b.purchased_at >= v_month_start and b.purchased_at < v_day_end
      )
    ) into v_figures
      from appointments a
     where a.account_id = p_account_id
       and a.deleted_at is null
       and a.starts_at >= v_day_start and a.starts_at < v_day_end;
  end if;

  -- The day list: a practitioner's own visits (an owner who treats keeps
  -- theirs, for the large widget), otherwise the whole clinic's.
  if v_view <> 'none' then
    v_own := v_me.is_practitioner;
    with live as (
      select a.id, a.starts_at, a.status, a.checked_in_at,
             pa.first_name, pa.last_name, at.name as type_name, tm.full_name as practitioner
        from appointments a
        left join patients pa on pa.id = a.patient_id
        left join appointment_types at on at.id = a.appointment_type_id
        left join team_members tm on tm.id = a.practitioner_id
       where a.account_id = p_account_id
         and a.deleted_at is null
         and a.status in ('booked', 'completed')
         and a.starts_at >= v_day_start and a.starts_at < v_day_end
         and (not v_own or a.practitioner_id = v_me.id)
    )
    select jsonb_build_object(
      'scope', case when v_own then 'own' else 'clinic' end,
      'total', (select count(*) from live),
      'done', (select count(*) from live where status = 'completed'),
      'arrived', (select count(*) from live where status <> 'completed' and checked_in_at is not null),
      'next', coalesce((
        select jsonb_agg(n order by n.starts_at)
          from (
            select l.id, l.starts_at, l.first_name, l.last_name, l.type_name, l.practitioner,
                   l.checked_in_at is not null as arrived
              from live l
             where l.status <> 'completed' and l.starts_at >= now() - interval '15 minutes'
             order by l.starts_at
             limit 8
          ) n
      ), '[]'::jsonb)
    ) into v_day;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'view', v_view,
    'who', v_me.full_name,
    'clinic', (select name from accounts where id = p_account_id),
    'today', v_today,
    'time_zone', v_tz,
    'figures', v_figures,
    'day', v_day
  ));
end;
$$;

revoke all on function public.get_home_widget(uuid, text) from public, anon;
grant execute on function public.get_home_widget(uuid, text) to authenticated;
