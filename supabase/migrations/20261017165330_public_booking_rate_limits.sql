-- Two brakes on the public booking surface, which anyone can reach with the
-- publishable key and no account.
--
-- 1. A per-caller counter the Netlify function consults before doing work.
--    The developer API already has one (api_rate_limits, 0149), but it is
--    keyed by api_tokens.id with a foreign key, so it cannot count a visitor
--    with no token. This one is keyed by any text -- the function uses
--    "<endpoint>:<client ip>" -- and nothing else reads it: the only grant is
--    to the service role, through the function below.
create table if not exists public.public_rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.public_rate_limits enable row level security;
select public.require_two_factor_on('public.public_rate_limits');

-- Same shape as consume_api_rate_limit: one INSERT .. ON CONFLICT, so two
-- concurrent requests cannot both read a stale count. A window that has
-- expired starts again at now() with this request as its first.
create or replace function public.consume_public_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
begin
  insert into public_rate_limits (key, window_started_at, request_count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set
      window_started_at = case
        when public_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then v_now
        else public_rate_limits.window_started_at
      end,
      request_count = case
        when public_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then 1
        else public_rate_limits.request_count + 1
      end
  returning public_rate_limits.window_started_at, public_rate_limits.request_count
  into v_window_start, v_count;

  -- Keys are client addresses, so the table would otherwise grow by one row
  -- per visitor forever. About one call in a hundred sweeps the day-old ones;
  -- a stale row only ever means a fresh window, never a refusal.
  if random() < 0.01 then
    delete from public_rate_limits where window_started_at < v_now - interval '1 day';
  end if;

  return query select
    v_count <= p_limit,
    greatest(0, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;

revoke execute on function public.consume_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer, integer) to service_role;

-- 2. A ceiling on online bookings per clinic, enforced where the booking is
--    actually made. create_public_booking() is SECURITY DEFINER and callable
--    by anon straight through PostgREST, so a limit in the Netlify function
--    alone would only slow down whoever goes through the page. Sixty online
--    bookings in ten minutes is far beyond any real clinic (Columnaquiro's
--    busiest booking day was under twenty), and well above what a Cypress
--    shard makes. Staff bookings, the API and the waitlist are not counted:
--    only source = 'online' goes through this.
create or replace function public.appointments_online_booking_ceiling()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  if new.source <> 'online' then
    return new;
  end if;
  select count(*) into v_recent
  from appointments
  where account_id = new.account_id
    and source = 'online'
    and created_at > now() - interval '10 minutes';
  if v_recent >= 60 then
    -- Worded for the patient: create_public_booking's refusals are shown on
    -- the booking page as they are.
    raise exception 'Ahora mismo hay demasiadas reservas en curso en esta clínica. Inténtalo de nuevo en unos minutos.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_online_booking_ceiling on public.appointments;
create trigger appointments_online_booking_ceiling
  before insert on public.appointments
  for each row execute function public.appointments_online_booking_ceiling();
