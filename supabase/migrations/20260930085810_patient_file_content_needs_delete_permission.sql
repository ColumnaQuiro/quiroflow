-- Removing a patient file's content from storage needs the same permission as
-- deleting its row: patient_files_delete.
--
-- One "for all" policy (0014) let any member of the account remove any object
-- in its patient-files folder, while the row beside it needs
-- patient_files_delete. The Files tab removed the object first and ignored
-- the row delete's result, so a role without the permission destroyed the
-- file and kept a row that opens to nothing: four such rows were found in
-- production on 30 Sep 2026, their content unrecoverable. The tab now deletes
-- the row first; this is the floor under it.
--
-- Reading, uploading and replacing (compression re-uploads in place) stay
-- open to every member, as before.
drop policy "staff manage patient-files storage" on storage.objects;

create policy "staff read patient-files storage" on storage.objects
  for select using (bucket_id = 'patient-files' and public.is_account_member((storage.foldername(name))[1]::uuid));

create policy "staff upload patient-files storage" on storage.objects
  for insert with check (bucket_id = 'patient-files' and public.is_account_member((storage.foldername(name))[1]::uuid));

create policy "staff replace patient-files storage" on storage.objects
  for update using (bucket_id = 'patient-files' and public.is_account_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'patient-files' and public.is_account_member((storage.foldername(name))[1]::uuid));

create policy "staff delete patient-files storage" on storage.objects
  for delete using (
    bucket_id = 'patient-files'
    and public.is_account_member((storage.foldername(name))[1]::uuid)
    and public.has_permission((storage.foldername(name))[1]::uuid, 'patient_files_delete')
  );
