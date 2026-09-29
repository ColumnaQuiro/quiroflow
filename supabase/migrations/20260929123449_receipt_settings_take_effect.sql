-- Receipt settings take effect.
--
-- Settings > Receipt Settings (now Settings > Invoicing) has saved nine
-- show/hide switches, an "email receipts automatically" default and a receipt
-- email subject and message since 0100 -- and nothing read any of them except
-- hide_next_visit_on_invoices. The receipt PDF, the receipt email and patient
-- creation now do.
--
-- 1. Receipts keep looking exactly as they do today until someone changes a
--    switch. Today's receipt prints the patient's ID and prints neither the
--    practitioner nor the account balance; the defaults said the opposite of
--    all three, and nobody chose them, because they did nothing. So those
--    three are set to what receipts actually print, and the defaults follow,
--    for accounts created from now on. The other switches keep their stored
--    values: an account that turned on date of birth or taxes asked for them.
update accounts
set show_ssn_on_invoices = true,
    hide_provider_on_invoices = true,
    hide_account_balance = true;

alter table accounts
  alter column show_ssn_on_invoices set default true,
  alter column hide_provider_on_invoices set default true,
  alter column hide_account_balance set default true;

-- 2. "Email receipts automatically" is what a new patient starts with.
--
-- Nothing inserts invoice_email_enabled explicitly -- every path that creates
-- a patient (the new-patient dialog, online booking, the app, importers, the
-- API, lead conversion) leaves it at the column default -- so the account's
-- choice is applied here, once, rather than in each of them. It only ever
-- turns the flag on: an insert cannot say "explicitly off" apart from the
-- default, and off is what every path meant until now.
create or replace function patients_default_invoice_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.invoice_email_enabled then
    select coalesce(a.send_invoices_automatically_default, false)
      into new.invoice_email_enabled
      from accounts a
     where a.id = new.account_id;
    new.invoice_email_enabled := coalesce(new.invoice_email_enabled, false);
  end if;
  return new;
end;
$$;

revoke all on function patients_default_invoice_email() from public, anon, authenticated;

drop trigger if exists patients_default_invoice_email on patients;
create trigger patients_default_invoice_email
  before insert on patients
  for each row execute function patients_default_invoice_email();
