-- Education articles written like a page rather than a text box: formatted
-- text, headings, lists, quotes, callouts and images, a cover for the
-- library, and the same article in other languages.
--
--   learn_articles.content       the body as blocks (utils/learnContent.ts):
--                                [{ id, type, runs | path, ... }]. Never HTML:
--                                every reader draws the blocks itself, so
--                                what a member stores through the Data API
--                                cannot run in a patient's browser.
--   learn_articles.translations  { "en": { title, summary, content }, ... },
--                                as doc_templates.translations: one article,
--                                its words per language. A patient is shown
--                                the language on their record when the
--                                article has it, the original otherwise.
--   learn_articles.cover_path    the library card's and the article's image,
--                                in learn-media.
--   learn_articles.asset_paths   every learn-media object the article points
--                                at, in any language, kept by the trigger
--                                below. What a patient may sign is read from
--                                here, so the storage policy does not have to
--                                walk the JSON.
--
-- `body` stays, and is still written: it is the plain-text form of `content`
-- (contentPlainText), so app versions already on phones -- which read only
-- body -- keep showing the article's words, and an article with no blocks
-- (everything written before this) is still read from it.
--
-- Tags were always free text in the column; only the editor offered a fixed
-- list. A clinic's own tags need nothing here.

alter table public.learn_articles
  add column if not exists content jsonb not null default '[]'::jsonb,
  add column if not exists translations jsonb not null default '{}'::jsonb,
  add column if not exists cover_path text,
  add column if not exists asset_paths text[] not null default '{}';

alter table public.learn_articles drop constraint if exists learn_articles_content_is_array;
alter table public.learn_articles add constraint learn_articles_content_is_array check (jsonb_typeof(content) = 'array');
alter table public.learn_articles drop constraint if exists learn_articles_translations_is_object;
alter table public.learn_articles add constraint learn_articles_translations_is_object check (jsonb_typeof(translations) = 'object');

-- The objects an article uses, from wherever they appear. Only paths in the
-- article's own clinic's folder count: a path is free text, and a member of
-- one clinic naming another clinic's file here would otherwise let their
-- patients sign it.
create or replace function public.learn_articles_collect_assets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(array_agg(distinct p order by p), '{}')
  into new.asset_paths
  from (
    select new.media_path as p
    union all
    select new.cover_path
    union all
    select b ->> 'path'
    from jsonb_array_elements(case when jsonb_typeof(new.content) = 'array' then new.content else '[]'::jsonb end) b
    where b ->> 'type' = 'image'
    union all
    select b ->> 'path'
    from jsonb_each(case when jsonb_typeof(new.translations) = 'object' then new.translations else '{}'::jsonb end) tr,
         jsonb_array_elements(case when jsonb_typeof(tr.value -> 'content') = 'array' then tr.value -> 'content' else '[]'::jsonb end) b
    where b ->> 'type' = 'image'
  ) x
  where p is not null and p like new.account_id::text || '/%';
  return new;
end;
$$;

drop trigger if exists trg_learn_articles_collect_assets on public.learn_articles;
create trigger trg_learn_articles_collect_assets
  before insert or update of media_path, cover_path, content, translations, account_id on public.learn_articles
  for each row execute function public.learn_articles_collect_assets();

-- Articles already there: their video is their only asset.
update public.learn_articles set media_path = media_path where media_path is not null;

-- Images in the same private bucket as the clinic's videos.
update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'learn-media';

-- A patient signs any object of an article they can see -- its video, cover
-- or images -- not only the video. Still asked of learn_articles under the
-- caller's own RLS, so its policies decide which articles those are.
drop policy if exists "patients read their articles' media" on storage.objects;
create policy "patients read their articles' media" on storage.objects
  for select using (
    bucket_id = 'learn-media'
    and name in (select unnest(a.asset_paths) from public.learn_articles a)
  );
