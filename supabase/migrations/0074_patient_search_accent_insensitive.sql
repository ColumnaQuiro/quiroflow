-- Patient name search is case-insensitive (ilike) but not accent-insensitive
-- today, so "jose" doesn't find "José". Generated column + immutable wrapper
-- follows the exact same pattern already established by slugify()
-- (0004_add_account_slug.sql) for the same reason: unaccent() itself is
-- STABLE, not IMMUTABLE, so it can't be used directly in a generated column,
-- but a SQL wrapper function asserting immutable (as slugify() already does)
-- is accepted since Postgres trusts the wrapper's own declared volatility.

create or replace function unaccent_lower(input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select lower(extensions.unaccent(coalesce(input, '')));
$$;

alter table patients add column search_name text generated always as (
  unaccent_lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
) stored;
