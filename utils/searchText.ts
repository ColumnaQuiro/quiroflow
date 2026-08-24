// Mirrors the DB's unaccent_lower() generated column (patients.search_name,
// 0074_patient_search_accent_insensitive.sql) so a client-typed search term
// matches it -- "jose" needs to become the same normalized form as "José" on
// the DB side before it's used in an .ilike() filter.
export function normalizeSearchTerm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
