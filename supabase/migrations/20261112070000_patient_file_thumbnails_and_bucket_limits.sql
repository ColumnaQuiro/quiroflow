-- Patient files: a thumbnail for the grid, a marker for the 2000 px resize,
-- limits on the avatar bucket, and a way to count what nothing points at.
--
-- Measured in production on 11 Nov 2026: Storage held 14 GB in 11.3k objects,
-- and 13.4 GB of that was the patient-files bucket -- 4,348 PDFs (8.9 GB,
-- 2.1 MB average, up to 25 MB), 3,457 JPEGs (4.5 GB, 1.3 MB average), 48 HEIC
-- (126 MB) and 18 mp4 (178 MB). Nearly all of it arrived in two bulk imports.
-- patient-photos, the avatars, was 2,550 objects and 22 MB.
--
-- Two things made that worse than it had to be. Photos were re-encoded but
-- never scaled, so a 12-megapixel phone picture stayed 12 megapixels for a
-- screen that shows two. And the Files tab used each photo's full-size file
-- as its own grid thumbnail, and loaded each whole PDF into an iframe per
-- card: a patient with forty scans downloaded all forty to look at the list.

-- 1. The thumbnail, and whether the file has been through the resize.
--
--    thumb_path: a ~480 px JPEG beside the original in the same private
--    bucket, at <folder>/thumbs/<name>.jpg (utils/patientFileStorage.ts
--    derives it from storage_path, so a path that removes a file can remove
--    its thumbnail without reading this column). Null for PDFs, video, images
--    sharp cannot read and anything not processed yet; the grid then behaves
--    as it did before.
--
--    resized_at: set once a file has been through the 2000 px cap and the
--    thumbnail step. compressed_at could not carry that -- every existing
--    file already has it, from before either existed -- and the backfill
--    (/api/internal/compress-existing-files, mode "resize") needs to tell
--    done from not done to be stopped and resumed.
--
--    patient_files already has its patient_id, so merge_patients moves these
--    with the row and needs no new line. anonymize_patient returns each
--    storage_path and /api/patients/anonymize derives the thumbnail from it.
alter table public.patient_files
  add column thumb_path text,
  add column resized_at timestamptz;

comment on column public.patient_files.thumb_path is
  'Path in patient-files of this image''s grid thumbnail (a small JPEG). Null when there is none; the grid then uses the file itself.';
comment on column public.patient_files.resized_at is
  'When this file went through the 2000 px resize and thumbnail step. Null = not yet (the resize backfill picks these up).';

-- What the backfill pages through.
create index patient_files_unresized_idx on public.patient_files (account_id, id)
  where resized_at is null and storage_path is not null;

-- Both columns are bookkeeping the server recomputes, like compressed_at and
-- size_bytes beside them: without this the backfill would write one audit row
-- per file it touched, 3,500 of them, attributed to whoever pressed the button.
drop trigger trg_audit_patient_files on public.patient_files;
create trigger trg_audit_patient_files after insert or update or delete on public.patient_files
  for each row execute function public.fn_audit_log('patient_file', 'compressed_at,size_bytes,storage_path,thumb_path,resized_at');

-- 2. Limits on the public image buckets.
--
--    None of them had any: a 25 MB file, or a PDF, could be uploaded as a
--    patient's avatar and served from a public URL. The avatars now arrive
--    already shrunk to a few dozen KB (utils/imageShrink.ts), so 5 MB only
--    ever stops a mistake -- and it is also what a Netlify function accepts
--    in a request body, which is how the phone-camera route receives one.
--
--    A limit applies to new uploads; objects already there are not touched.
--    patient-files is deliberately left with no limit and no type list: it
--    takes scanned PDFs of 25 MB, video, and whatever an import brings.
update storage.buckets
  set file_size_limit = 5242880, allowed_mime_types = array['image/*']
  where id = 'patient-photos';

update storage.buckets
  set allowed_mime_types = array['image/*']
  where id in ('team-member-photos', 'clinic-logos', 'campaign-images', 'doc-images');

-- 3. A report of what nothing points at. A REPORT: it deletes nothing.
--
--    Rows cascade when a patient is deleted and Storage objects do not, a
--    replaced avatar left its old file behind, and until now nothing could
--    say how much of the 14 GB that is. Sweeping it automatically is not on
--    the table -- a wrong rule there destroys clinical files -- so this only
--    counts, per bucket, the objects under one account's folder that no row
--    references, by the rule written beside each count.
--
--    orphan_objects is null where there is no rule to apply: campaign-images
--    and doc-images are referenced from inside email HTML and document JSON,
--    and saying "0 orphans" about a bucket nobody checked would be a lie.
--
--    Security definer because it reads storage.objects, and executable by the
--    service role only: /api/internal/storage-orphans calls it after checking
--    the caller holds settings_access and data_admin.
create or replace function public.storage_orphan_report(p_account_id uuid)
returns table (bucket text, objects bigint, bytes bigint, orphan_objects bigint, orphan_bytes bigint, rule text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  with o as (
    select ob.bucket_id,
           ob.name,
           coalesce((ob.metadata ->> 'size')::bigint, 0) as size,
           split_part(ob.name, '/', 2) as part2,
           split_part(ob.name, '/', 3) as part3,
           regexp_replace(ob.name, '^.*/', '') as base
    from storage.objects ob
    where ob.name like p_account_id::text || '/%'
  ),
  judged as (
    select o.bucket_id, o.size,
      case o.bucket_id
        when 'patient-files' then not (
          -- Exports are short-lived zips the export routes clean up themselves.
          o.part2 = 'exports'
          or exists (select 1 from patient_files f where f.account_id = p_account_id and (f.storage_path = o.name or f.thumb_path = o.name))
          or exists (
            select 1 from posture_assessments pa, jsonb_each(case when jsonb_typeof(pa.views) = 'object' then pa.views else '{}'::jsonb end) v
            where pa.account_id = p_account_id and v.value ->> 'photo' = o.name
          )
          or (o.part2 = 'posture' and o.base = 'informe.pdf'
              and exists (select 1 from posture_assessments pa where pa.account_id = p_account_id and pa.id::text = o.part3))
        )
        when 'patient-photos' then not exists (
          select 1 from patients p where p.account_id = p_account_id and p.photo_storage_path = o.name
        )
        when 'whatsapp-media' then not (
          -- Template header media: named inside the template, not in a column.
          o.part2 = 'campaigns'
          or exists (select 1 from whatsapp_messages m where m.account_id = p_account_id and m.media_storage_path = o.name)
        )
        when 'invoice-pdfs' then not (
          exists (select 1 from invoices i where i.account_id = p_account_id and i.patient_id::text = o.part2 and i.id::text || '.pdf' = o.base)
          or exists (select 1 from facturas fa where fa.account_id = p_account_id and fa.patient_id::text = o.part2 and 'factura-' || fa.id::text || '.pdf' = o.base)
        )
        when 'calendar-files' then not exists (
          select 1 from appointments a where a.account_id = p_account_id and a.patient_id::text = o.part2 and a.id::text || '.ics' = o.base
        )
        when 'team-member-photos' then not exists (
          select 1 from team_members tm where tm.account_id = p_account_id and tm.photo_storage_path = o.name
        )
        when 'clinic-logos' then not (
          exists (select 1 from clinics c where c.account_id = p_account_id and c.logo_storage_path = o.name)
          or exists (select 1 from accounts ac where ac.id = p_account_id and ac.patient_app_brand_logo_path = o.name)
          -- An issued factura keeps the logo it was issued with.
          or exists (select 1 from facturas fa where fa.account_id = p_account_id and fa.issuer_logo_storage_path = o.name)
        )
        else null
      end as orphan
    from o
  )
  select j.bucket_id::text,
         count(*)::bigint,
         coalesce(sum(j.size), 0)::bigint,
         case when bool_or(j.orphan is not null) then count(*) filter (where j.orphan)::bigint end,
         case when bool_or(j.orphan is not null) then coalesce(sum(j.size) filter (where j.orphan), 0)::bigint end,
         case j.bucket_id
           when 'patient-files' then 'no patient_files row (file or thumbnail) or posture assessment names it; exports/ not counted'
           when 'patient-photos' then 'no patient has it as photo_storage_path'
           when 'whatsapp-media' then 'no whatsapp_messages row names it; campaigns/ (template headers) not counted'
           when 'invoice-pdfs' then 'no invoice or factura with that id under that patient (a regenerable copy)'
           when 'calendar-files' then 'no appointment with that id under that patient (a regenerable copy)'
           when 'team-member-photos' then 'no team member has it as photo_storage_path'
           when 'clinic-logos' then 'no clinic, app branding or issued factura names it'
           else 'not checked: referenced from inside HTML or JSON, not from a column'
         end
  from judged j
  group by j.bucket_id
  order by 3 desc;
$$;

revoke all on function public.storage_orphan_report(uuid) from public, anon, authenticated;
grant execute on function public.storage_orphan_report(uuid) to service_role;

comment on function public.storage_orphan_report(uuid) is
  'Read-only: per bucket, the objects under one account''s folder and how many no row references. Deletes nothing. Service role only.';
