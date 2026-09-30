-- The automatic confirmation of a booking made without a member of staff --
-- the public booking page, the patient app, the public API -- is claimed
-- once, here, before anything is sent.
--
-- /api/public-booking/send-confirmation only checked that the appointment was
-- an online one under ten minutes old, so every call in those ten minutes sent
-- the patient another WhatsApp template (a paid send), another email and the
-- clinic another "new booking" alert. A claim is an update that succeeds for
-- exactly one caller:
--
--   update appointments set auto_confirmation_claimed_at = now()
--   where id = $1 and auto_confirmation_claimed_at is null
--
-- It is separate from confirmation_sent_at, which records that something
-- actually reached the patient and stays empty when nothing could.
alter table public.appointments add column auto_confirmation_claimed_at timestamptz;

comment on column public.appointments.auto_confirmation_claimed_at is
  'When the automatic confirmation of a booking made without staff (booking page, patient app, API) was claimed. Set once; a second claim finds it set and sends nothing.';
