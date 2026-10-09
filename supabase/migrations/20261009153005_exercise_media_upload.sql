-- A video or photo uploaded for a library exercise, instead of (or as well
-- as) a link: a practitioner films the exercise on their phone in the staff
-- app and the patient watches it inside their own app.
--
--   exercises.media_path    the object in the exercise-media bucket,
--                           "<account_id>/<random>.<ext>"; null for none
--
-- Private, unlike doc-images: a clinic's own footage, sometimes with its
-- staff in it, is not for anyone holding a URL. Read through short-lived
-- signed URLs.
--
-- Staff manage their clinic's folder. Patients may read an object only when
-- it is the media of an exercise THEY can see -- and the exercises table's
-- own policies already decide that (assigned to them, two-factor
-- satisfied), so the read policy just asks that table under the caller's
-- RLS rather than restating the rule.
alter table public.exercises add column media_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media',
  'exercise-media',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "staff manage exercise-media storage" on storage.objects
  for all using (
    bucket_id = 'exercise-media'
    and (storage.foldername(name))[1]::uuid in (select public.my_member_account_ids())
    and (select public.mfa_satisfied())
  )
  with check (
    bucket_id = 'exercise-media'
    and (storage.foldername(name))[1]::uuid in (select public.my_member_account_ids())
    and (select public.mfa_satisfied())
  );

create policy "patients read their exercises' media" on storage.objects
  for select using (
    bucket_id = 'exercise-media'
    and name in (select e.media_path from public.exercises e where e.media_path is not null)
  );
