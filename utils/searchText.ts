// Mirrors the DB's unaccent_lower() generated column (patients.search_name,
// 0074_patient_search_accent_insensitive.sql) so a client-typed search term
// matches it -- "jose" needs to become the same normalized form as "José" on
// the DB side before it's used in an .ilike() filter.
export function normalizeSearchTerm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Filter-syntax characters in PostgREST's .or()/.ilike() filter strings --
// stripped rather than escaped, so a stray "%", "_", "," or paren typed into
// a search box can't wildcard-match more broadly than intended or break the
// filter string's shape. Shared by every patient search box that builds a
// PostgREST .or() clause from raw user input (patient list, appointment
// panels, the command palette).
export function sanitizeSearchToken(s: string): string {
  return s.replace(/[%_,()]/g, '')
}
