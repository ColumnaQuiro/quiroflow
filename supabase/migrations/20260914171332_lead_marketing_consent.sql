-- Evidence that a lead agreed to be contacted.
--
-- Patients carry marketing_channels, an explicit opt-in, because LSSI-CE and
-- GDPR want consent for unsolicited commercial messages rather than an
-- inference. Leads had nothing equivalent, and the temptation is to treat the
-- existence of the row as permission -- somebody gave us a number, so we
-- message them. That is precisely the inference the law does not accept, and
-- a welcome drip is a commercial message however friendly it reads.
--
-- So it is recorded, with when and from where, at the moment of capture. A
-- Meta lead-ad form carries its own consent text; a landing page has its own
-- checkbox; a number typed in at the desk has neither, and that lead simply
-- does not receive marketing until somebody says otherwise.
--
-- Null means "not evidenced", which the automation engine reads as no. It
-- does not stop transactional replies -- answering somebody who asked a
-- question is not marketing.
alter table leads add column marketing_consent_at timestamptz;
alter table leads add column marketing_consent_source text;

comment on column leads.marketing_consent_at is
  'When the lead agreed to be contacted. Null means not evidenced: no marketing.';
comment on column leads.marketing_consent_source is
  'Where that agreement came from, e.g. the ad platform form or a landing page.';
