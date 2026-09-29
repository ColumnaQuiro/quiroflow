-- A service that has been charged cannot be deleted.
--
-- invoice_line_items.service_id was `on delete set null`, so deleting a
-- service quietly detached every receipt line charged under it: the lines
-- keep their price, but the income report's by-service figures lose them.
-- Settings > Services now offers Delete only on a service never charged, but
-- it counts through the viewer's own session, and a billing user whose access
-- is scoped to their own patients cannot see lines on other patients'
-- receipts -- so it could offer Delete on a service others had charged.
--
-- The database is the one place that sees every line, so it decides:
-- `restrict` refuses the delete, and the page says why. Renaming and
-- repricing are untouched, and a service nobody charged deletes as before.
alter table invoice_line_items
  drop constraint invoice_line_items_service_id_fkey,
  add constraint invoice_line_items_service_id_fkey
    foreign key (service_id) references services_products(id) on delete restrict;
