-- Somewhere to put a generated invoice PDF so a patient can be handed a
-- link to it.
--
-- The patient app runs in a WKWebView, where a download attribute does
-- nothing and a blob URL opened in a new tab goes nowhere -- the one thing
-- that does work is opening a real URL and letting the system viewer take
-- it, which is exactly how a shared file already reaches a patient (see
-- server/api/patient-files/signed-url.post.ts). So the PDF has to exist at
-- a URL, and that means it has to exist somewhere.
--
-- Private, and deliberately not the patient-files bucket: that one holds
-- what the clinic uploaded, and these are regenerated artefacts, rewritten
-- on every request. No RLS policies at all -- nothing reaches these objects
-- except the service role minting a short-lived signed URL, after the
-- patient's own RLS read has proved the invoice is theirs.
insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', false)
on conflict (id) do nothing;
