-- Future-proofing for per-account subdomains later: every account gets a
-- URL-safe slug generated at creation time. Unused by the app today, but
-- means subdomain routing can be added later without a backfill migration.
-- unaccent lives in `extensions` (Supabase convention), not `public`.

create extension if not exists unaccent with schema extensions;

create or replace function slugify(input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(both '-' from regexp_replace(lower(extensions.unaccent(input)), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function generate_unique_account_slug(base_name text)
returns text
language plpgsql
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix int := 1;
begin
  base_slug := slugify(base_name);
  if base_slug = '' or base_slug is null then
    base_slug := 'practice';
  end if;

  candidate := base_slug;
  while exists (select 1 from accounts where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  return candidate;
end;
$$;

alter table accounts add column slug text unique;

update accounts set slug = generate_unique_account_slug(name) where slug is null;

alter table accounts alter column slug set not null;
