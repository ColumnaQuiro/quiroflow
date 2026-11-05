-- The owner's home-screen widget (utils/homeWidget.ts) gains three figures:
--
--   bonos_owed_cents     -- what is still to collect on the bonos sold this
--                           month. Bono sales above the month's takings
--                           read as a contradiction: bonos are sold at full
--                           price and paid in parts, and only the parts paid
--                           so far are takings. The
--                           arithmetic is utils/bonoOwed.ts's, restated here
--                           so the widget agrees with the Billing tab and
--                           the Debtors report:
--                             * owed_cents set (sold here, or migrated from
--                               PracticeHub): owed_cents less what was paid
--                               on THIS side -- an imported 'phpay-' payment
--                               is already netted into PracticeHub's figure;
--                             * otherwise a valid sale invoice: its total
--                               less every payment against it or the bono;
--                             * otherwise nothing, unless a payment is linked,
--                               in which case the price less those payments.
--                           Money taken on account (purpose 'on_account') never
--                           pays a bono down.
--   payments_prev_cents  -- money taken over the same stretch of LAST month,
--   bonos_prev_cents        and bono sales over it, for "up 12% vs Oct".
--                           The stretch runs from the 1st to this very
--                           moment one month ago, so a morning compares
--                           against a morning and not against a whole day
--                           already taken. Postgres clamps the month (31 Oct
--                           minus a month is 30 Sep), so the last days of a
--                           long month compare against the whole short one.
--
-- Every other figure, and who gets which view, is unchanged from
-- 20261020142327_home_widget.sql.
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
  v_prev_start timestamptz;
  v_prev_end timestamptz;
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
  v_prev_start := (date_trunc('month', v_today)::date - interval '1 month') at time zone v_tz;
  v_prev_end := ((now() at time zone v_tz) - interval '1 month') at time zone v_tz;

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
      'payments_prev_cents', (
        select coalesce(sum(p.amount_cents), 0)
          from payments p
          left join invoices i on i.id = p.invoice_id
         where p.account_id = p_account_id
           and p.paid_at >= v_prev_start and p.paid_at < v_prev_end
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
      ),
      'bonos_prev_cents', (
        select coalesce(sum(b.price_cents), 0) from package_purchases b
         where b.account_id = p_account_id and b.purchased_at >= v_prev_start and b.purchased_at < v_prev_end
      ),
      'bonos_owed_cents', (
        select coalesce(sum(greatest(0, case
                 when b.owed_cents is not null then b.owed_cents - coalesce(pay.here_cents, 0)
                 when i.id is not null then i.total_cents - coalesce(pay.all_cents, 0)
                 when coalesce(pay.n, 0) = 0 then 0
                 else b.price_cents - coalesce(pay.all_cents, 0)
               end)), 0)
          from package_purchases b
          left join invoices i on i.id = b.invoice_id and i.status <> 'void'
          left join lateral (
            select sum(p.amount_cents) as all_cents,
                   sum(p.amount_cents) filter (where coalesce(p.external_reference, '') not like 'phpay-%') as here_cents,
                   count(*) as n
              from payments p
             where coalesce(p.purpose, '') <> 'on_account'
               and (p.package_purchase_id = b.id or (i.id is not null and p.invoice_id = i.id))
          ) pay on true
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
