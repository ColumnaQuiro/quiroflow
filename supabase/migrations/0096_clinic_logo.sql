-- Clinic logo for invoices -- same public-bucket pattern as patient-photos
-- (0077_patient_photo.sql): a display asset, not a sensitive document, so a
-- plain public URL works without re-signing.
alter table clinics add column logo_storage_path text;

insert into storage.buckets (id, name, public)
values ('clinic-logos', 'clinic-logos', true)
on conflict (id) do nothing;

create policy "staff manage clinic-logos storage" on storage.objects
  for all using (
    bucket_id = 'clinic-logos' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'clinic-logos' and is_account_member((storage.foldername(name))[1]::uuid)
  );
