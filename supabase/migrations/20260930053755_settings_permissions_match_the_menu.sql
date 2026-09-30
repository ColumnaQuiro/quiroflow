-- Found in the settings QA round (30 Sep 2026): four tables whose policies
-- did not match what the Settings menu gates, and one owner-only setting the
-- owner guard did not cover.

-- 1. doc_templates. One "for all" policy gated on communication_config meant
-- that READING a template needed it too. The default Practitioner and Front
-- Desk roles do not hold it, so for them a patient's Docs tab offered no
-- templates to fill in, and Reports > Data exports found no consent or data
-- protection template and listed every patient as missing both. Reading is
-- what everyone who fills in forms needs; editing the templates stays with
-- communication_config.
drop policy "staff manage doc_templates" on doc_templates;

create policy "staff read doc_templates" on doc_templates
  for select using (is_account_member(account_id));
create policy "staff insert doc_templates" on doc_templates
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff update doc_templates" on doc_templates
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "staff delete doc_templates" on doc_templates
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

-- 2. saved_replies. Reading needed inbox_access while Settings > Saved
-- Replies is gated on communication_config, so a role with only the second
-- saw an empty list and could not create a reply (the insert reads the new
-- row back). Either permission now reads them.
alter policy "staff view saved_replies" on saved_replies
  using (is_account_member(account_id)
         and (has_permission(account_id, 'inbox_access') or has_permission(account_id, 'communication_config')));

-- 3. payment_methods. Any member could add, rename, switch off or delete
-- them through the REST API -- the credit and write_off rows included, which
-- carry behaviour. Everyone who takes a payment still reads them; changing
-- them needs billing_config, like Settings > Payments, and the two system
-- rows are not changed by anyone. (Seeding a new account runs as security
-- definer and is not affected.)
drop policy "staff manage payment_methods" on payment_methods;

create policy "staff read payment_methods" on payment_methods
  for select using (is_account_member(account_id));
create policy "staff insert payment_methods" on payment_methods
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'billing_config') and not is_system);
create policy "staff update payment_methods" on payment_methods
  for update using (is_account_member(account_id) and has_permission(account_id, 'billing_config') and not is_system)
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config') and not is_system);
create policy "staff delete payment_methods" on payment_methods
  for delete using (is_account_member(account_id) and has_permission(account_id, 'billing_config') and not is_system);

-- 4. webhooks. Settings > Webhooks only accepts https://, but that was the
-- page; the table took anything, and the trigger posts patient data to it.
-- NOT VALID: enforced on every new or changed row without scanning old ones
-- (production had none).
alter table webhooks
  add constraint webhooks_url_is_https check (url ~* '^https://') not valid;

-- 5. VeriFactu sender. Who transmits a clinic's records (its own
-- certificate, or QuiroFlow under an apoderamiento or colaboración social)
-- is set by an owner through /api/verifactu/sender, but the column sits on
-- accounts, which any member can update. A receptionist PATCHing it to a
-- delegation not yet confirmed stops transmission, with the AEAT's
-- four-minute window running. The owner guard now covers it. The endpoint
-- runs as the service role (no auth.uid()), so it is unaffected.
create or replace function public.accounts_guard_verifactu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started boolean;
begin
  if new.verifactu_mode is not distinct from old.verifactu_mode
     and new.verifactu_production_from is not distinct from old.verifactu_production_from
     and new.verifactu_sender is not distinct from old.verifactu_sender then
    return new;
  end if;

  if auth.uid() is not null and not exists (
    select 1 from public.team_members tm
    where tm.account_id = new.id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
  ) then
    raise exception 'Only an owner can change the VeriFactu settings' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.factura_records r
    where r.account_id = new.id and r.environment = 'production'
  ) into v_started;

  if v_started then
    if new.verifactu_production_from is distinct from old.verifactu_production_from then
      raise exception 'The live date cannot change: the production chain has already started' using errcode = '42501';
    end if;
    if new.verifactu_mode <> 'live' then
      raise exception 'VeriFactu cannot be switched off or back to test once records have gone to production' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_guard_verifactu on public.accounts;
create trigger accounts_guard_verifactu
  before update of verifactu_mode, verifactu_production_from, verifactu_sender on public.accounts
  for each row execute function public.accounts_guard_verifactu();
