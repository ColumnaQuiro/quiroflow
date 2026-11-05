-- The education library, open to the clinic's patients. Until now an article
-- reached a patient only when a practitioner sent it (learn_sends). A clinic
-- can now make one visible to every patient of theirs -- "Hábitos y
-- consejos" in the app and the portal -- attach a video it filmed itself
-- rather than only a YouTube link, and tell everyone with the app once, when
-- it goes up.
--
--   learn_articles.visible_to_patients  shown to all the clinic's patients
--   learn_articles.media_path           the clinic's own video, in the
--                                       learn-media bucket,
--                                       "<account_id>/<random>.<ext>"
--   learn_articles.announced_at         when "Avisar al publicar" pushed it;
--                                       set once, so editing it never pushes
--                                       a second time
--
-- A patient who opens a library article gets a learn_sends row of their own
-- (channel 'library', opened at once), through open_library_article below.
-- That keeps one reader for both paths and lets the record say what they
-- have read, whichever way it reached them.

alter table public.learn_articles
  add column if not exists visible_to_patients boolean not null default false,
  add column if not exists media_path text,
  add column if not exists announced_at timestamptz;

alter table public.learn_sends drop constraint if exists learn_sends_channel_check;
alter table public.learn_sends add constraint learn_sends_channel_check
  check (channel in ('app', 'email', 'link', 'library'));
create unique index if not exists learn_sends_one_library_open
  on public.learn_sends (patient_id, article_id) where channel = 'library';

-- A patient reads the visible, unarchived articles of the clinics they are a
-- patient of. Alongside "patients view articles sent to them", which still
-- covers an article sent to them that the clinic never made public.
create policy "patients view their clinic's public articles" on public.learn_articles for select
  using (
    visible_to_patients
    and archived_at is null
    and account_id in (select p.account_id from public.patients p where p.user_id = (select auth.uid()))
  );

-- Opening an article from the library: the caller's own send for it,
-- created the first time (and marked opened), so LearnRead and the record
-- treat it like any other. Definer because patients may not insert sends;
-- it checks everything a send needs -- the article is visible, the caller is
-- that clinic's patient, the second factor is satisfied where required.
create or replace function public.open_library_article(p_article_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_send_id uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'two-factor required' using errcode = '42501';
  end if;

  select a.account_id into v_account_id
  from learn_articles a
  where a.id = p_article_id and a.visible_to_patients and a.archived_at is null;
  if v_account_id is null then
    raise exception 'article not found' using errcode = 'P0002';
  end if;

  select p.id into v_patient_id
  from patients p
  where p.user_id = auth.uid() and p.account_id = v_account_id
  order by p.created_at
  limit 1;
  if v_patient_id is null then
    raise exception 'article not found' using errcode = 'P0002';
  end if;

  -- Sent to them before? Read that one, so it is marked read where the
  -- practitioner will look for it.
  select s.id into v_send_id
  from learn_sends s
  where s.patient_id = v_patient_id and s.article_id = p_article_id
  order by s.sent_at desc
  limit 1;

  if v_send_id is null then
    insert into learn_sends (account_id, patient_id, article_id, channel, opened_at)
    values (v_account_id, v_patient_id, p_article_id, 'library', now())
    on conflict (patient_id, article_id) where channel = 'library' do nothing
    returning id into v_send_id;
    if v_send_id is null then
      select s.id into v_send_id from learn_sends s
      where s.patient_id = v_patient_id and s.article_id = p_article_id and s.channel = 'library';
    end if;
  else
    update learn_sends set opened_at = now() where id = v_send_id and opened_at is null;
  end if;

  return v_send_id;
end;
$$;
revoke all on function public.open_library_article(uuid) from public, anon;
grant execute on function public.open_library_article(uuid) to authenticated;

-- The clinic's own videos. Private, read through short-lived signed URLs,
-- like exercise-media; a bucket of its own because these run to two
-- minutes, four times what an exercise clip is allowed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learn-media',
  'learn-media',
  false,
  209715200,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

create policy "staff manage learn-media storage" on storage.objects
  for all using (
    bucket_id = 'learn-media'
    and (storage.foldername(name))[1]::uuid in (select public.my_member_account_ids())
    and (select public.mfa_satisfied())
  )
  with check (
    bucket_id = 'learn-media'
    and (storage.foldername(name))[1]::uuid in (select public.my_member_account_ids())
    and (select public.mfa_satisfied())
  );

-- A patient may sign a video only when it belongs to an article they can
-- see; learn_articles' own policies decide that, so this asks the table
-- under the caller's RLS rather than restating the rule.
create policy "patients read their articles' media" on storage.objects
  for select using (
    bucket_id = 'learn-media'
    and name in (select a.media_path from public.learn_articles a where a.media_path is not null)
  );
