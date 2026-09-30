-- Webhooks move from Settings > Data to Settings > Developers, beside API &
-- Tokens, and take that section's permission. A webhook's secret and the
-- stream of patient and appointment events it receives are the same kind of
-- grant as an API token, so one permission should govern both.
--
-- Nobody real loses anything: on 29 Sep 2026 the only non-owner roles holding
-- data_admin were in the two demo accounts (owners pass has_permission
-- regardless), and no clinic had created a webhook.
alter policy "staff manage webhooks" on webhooks
  using (is_account_member(account_id) and has_permission(account_id, 'developers_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'developers_access'));

alter policy "staff read webhook_deliveries" on webhook_deliveries
  using (is_account_member(account_id) and has_permission(account_id, 'developers_access'));
