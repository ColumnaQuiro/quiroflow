// Supabase Storage rejects object keys containing certain non-ASCII
// characters outright ("Invalid key") -- discovered when migrating
// PracticeHub attachments, where every file with an accented character in
// its original name (accented vowels, enye...) failed to upload while
// plain-ASCII names succeeded. Every call site that builds a storage path
// from a user-supplied filename needs this, not just uploads through the
// app UI -- clinic staff routinely name files in Spanish.
const ACCENT_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
}

export function sanitizeStorageFilename(name: string): string {
  const transliterated = name.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => ACCENT_MAP[c] ?? c)
  return transliterated.replace(/[^a-zA-Z0-9._-]/g, '_')
}
