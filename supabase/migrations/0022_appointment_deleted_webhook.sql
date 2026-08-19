-- Adds the appointment.deleted event. Appointments can be hard-deleted from
-- the Calendar modal (not just cancelled via status), and that vanish
-- wasn't previously observable by subscribers.

create trigger trg_webhook_appointment_deleted
  after delete on appointments
  for each row execute function fn_dispatch_webhook_event('appointment.deleted');
