-- Diagrams a clinic uploads for a `drawable_image` doc block: a body chart,
-- a spine, a foot -- whatever the patient is asked to mark their pain on.
--
-- Public, for the same reason clinic-logos is (0096_clinic_logo.sql): the
-- diagram is a blank template the clinic chose, not patient data, and
-- /doc/[token] renders it for a patient who is not signed in at all. A
-- public URL avoids having to sign one from an anon session.
--
-- The patient's marks are NOT in here. They are a transparent PNG living in
-- patient_docs.fields alongside the signature, so the diagram and what was
-- drawn on it stay separable -- and so replacing a template's diagram never
-- rewrites a document someone already signed.
insert into storage.buckets (id, name, public)
values ('doc-images', 'doc-images', true)
on conflict (id) do nothing;

create policy "staff manage doc-images storage" on storage.objects
  for all using (
    bucket_id = 'doc-images' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'doc-images' and is_account_member((storage.foldername(name))[1]::uuid)
  );
