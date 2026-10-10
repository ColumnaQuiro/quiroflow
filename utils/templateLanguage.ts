// Which language of a WhatsApp template a person is sent.
//
// Meta approves a template one language at a time, all under the same name
// ("revision_review_request" in es and en). A step set to send in the
// patient's language takes theirs when that variant is approved: the exact
// code first, then the base language, so a patient marked 'en' gets 'en_US'.
// Null when there is no such variant, and the step's own language is used.

export function templateVariantForLanguage(candidates: { language: string; status?: string }[], language: string | null | undefined): string | null {
  if (!language) return null
  const approved = candidates.filter((t) => !t.status || t.status === 'APPROVED')
  const base = (l: string) => l.split('_')[0]!.toLowerCase()
  return (approved.find((t) => t.language === language) ?? approved.find((t) => base(t.language) === base(language)))?.language ?? null
}
