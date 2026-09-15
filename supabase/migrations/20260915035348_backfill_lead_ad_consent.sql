-- Consent for leads captured before it was recorded.
--
-- marketing_consent_at arrived after lead ingest did, so leads already
-- captured have null -- which the automation engine reads as "no marketing",
-- and would exclude them from the welcome drip they were captured for.
--
-- Backfilled only where the capture itself carried consent: a Meta lead-ad
-- form shows its own consent text above the submit button, so a submission
-- through one is an agreement to be contacted about the thing advertised.
-- That is a real lawful basis, not a convenient assumption.
--
-- Deliberately NOT backfilled for anything else. A number typed in at the
-- desk, a phone enquiry, a walk-in -- none of those carried consent text, and
-- inferring it from "we have their number" is exactly the reasoning LSSI-CE
-- and GDPR reject. Those leads stay null and receive no marketing until
-- somebody records an actual agreement.
--
-- The source records that this was backfilled rather than captured live. If
-- anyone ever audits a send, that distinction is the honest answer to "how do
-- you know they agreed?" -- inferred from the capture channel, on this date,
-- rather than observed at the time.
update leads
set marketing_consent_at = created_at,
    marketing_consent_source = 'meta_lead_form (backfilled 2026-09-15)'
where marketing_consent_at is null
  and external_source = 'facebook'
  and external_id is not null;
