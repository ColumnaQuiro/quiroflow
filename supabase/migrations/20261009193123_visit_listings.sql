-- Spinal listings: the chiropractor's record of which segments were
-- adjusted on a visit, and on which side -- OCC to coccyx, plus the
-- extremities -- tapped L or R on a grid beside the visit notes rather than
-- typed into them. One row per visit:
--
--   listings   {"C5": "R", "T4": "L", "L5": "B"}  (B = both sides)
--
-- Keyed by appointment, so the patient comes from the visit and there is no
-- patient_id here (merge_patients moves appointments, which carries these).
-- Access mirrors visit_notes: read with visit_notes_access, change with
-- visit_notes_edit, remove with visit_notes_delete. Audited as part of the
-- visit note (fn_audit_log('visit_note') finds the patient through
-- appointment_id), since that is what a listing is.
create table public.visit_listings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  listings jsonb not null default '{}'::jsonb check (jsonb_typeof(listings) = 'object'),
  updated_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visit_listings_account_id_idx on public.visit_listings (account_id);
create index visit_listings_updated_by_idx on public.visit_listings (updated_by);

alter table public.visit_listings enable row level security;

create policy "staff select visit_listings" on public.visit_listings for select
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
create policy "staff insert visit_listings" on public.visit_listings for insert
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_access'));
create policy "staff update visit_listings" on public.visit_listings for update
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_edit'));
create policy "staff delete visit_listings" on public.visit_listings for delete
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'visit_notes_delete'));

select public.require_two_factor_on('public.visit_listings');

create trigger trg_audit_visit_listings
  after insert or update or delete on public.visit_listings
  for each row execute function public.fn_audit_log('visit_note');
