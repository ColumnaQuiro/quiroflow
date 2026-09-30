-- Report pages: a clinic's own dashboards, each a grid of report blocks with
-- its own period and filters (Reports > Report pages). They replace the
-- single-chart Custom Reports page; its saved reports (custom_reports) stay
-- where they are and are offered as blocks under "Saved reports".
--
-- `blocks` is the grid, in order:
--   [{ id, title, span (3|4|6|8|12), config: { metric, split, chart, filters, period } }]
-- and `settings` is what the page opens with: { period, compare }. Both are
-- read and written only by the app; the database keeps them as documents.
--
-- A page is either the author's alone ('private') or the whole clinic's
-- ('clinic'). Everyone who can see it can use it; only the author, and
-- owners, can change or delete it. "Only me" means only the author: an owner
-- does not see someone's private page either. Reading any of it also takes Reports
-- access, like the reports themselves.
create table public.report_pages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  visibility text not null default 'clinic' check (visibility in ('private', 'clinic')),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index report_pages_account_idx on public.report_pages (account_id);

alter table public.report_pages enable row level security;

-- The author's team member row in THIS account: my_team_member_id() takes the
-- first membership it finds, which is the wrong one for someone in two
-- clinics' accounts.
create or replace function public.is_my_team_member(target_account_id uuid, member_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from team_members tm
    where tm.id = member_id and tm.account_id = target_account_id
      and tm.user_id = auth.uid() and tm.deleted_at is null
  );
$$;
revoke all on function public.is_my_team_member(uuid, uuid) from public;
grant execute on function public.is_my_team_member(uuid, uuid) to authenticated;

create or replace function public.is_account_owner(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from team_members tm
    where tm.account_id = target_account_id and tm.user_id = auth.uid()
      and tm.is_owner and tm.deleted_at is null
  );
$$;
revoke all on function public.is_account_owner(uuid) from public;
grant execute on function public.is_account_owner(uuid) to authenticated;

create policy "staff read report pages" on public.report_pages
  for select using (
    is_account_member(account_id)
    and has_permission(account_id, 'reports_access')
    and (visibility = 'clinic' or is_my_team_member(account_id, created_by))
  );

-- Created as oneself: a page cannot be made in someone else's name, which is
-- what decides who may edit it afterwards.
create policy "staff create report pages" on public.report_pages
  for insert with check (
    is_account_member(account_id)
    and has_permission(account_id, 'reports_access')
    and is_my_team_member(account_id, created_by)
  );

create policy "author or owner edits report pages" on public.report_pages
  for update using (
    is_account_member(account_id)
    and has_permission(account_id, 'reports_access')
    and (is_my_team_member(account_id, created_by) or is_account_owner(account_id))
  )
  with check (
    is_account_member(account_id)
    and has_permission(account_id, 'reports_access')
    and (is_my_team_member(account_id, created_by) or is_account_owner(account_id))
  );

create policy "author or owner deletes report pages" on public.report_pages
  for delete using (
    is_account_member(account_id)
    and (is_my_team_member(account_id, created_by) or is_account_owner(account_id))
  );

-- The author cannot be changed by an edit: an owner tidying a page does not
-- take it over, and nobody can hand a page to someone else to dodge the
-- author rule above.
create or replace function public.report_pages_keep_author()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Emptied is allowed: that is the foreign key's `on delete set null` when
  -- the author's team member row goes, and the page then belongs to owners.
  if (new.created_by is distinct from old.created_by and new.created_by is not null)
     or new.account_id is distinct from old.account_id then
    raise exception 'A report page keeps its author and account' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger report_pages_keep_author
  before update on public.report_pages
  for each row execute function public.report_pages_keep_author();

select public.require_two_factor_on('public.report_pages');
