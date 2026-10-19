// The languages a clinic can tell its receptionist it supports
// (receptionist_config.languages). The prompt says "Reply in the language
// the patient writes in. The clinic supports: …" from this list, so it is
// closed: a code that is not here would put a word the model cannot read
// into that sentence.
//
// Pure, with no `~` imports: the app auto-imports this directory too.

export const RECEPTIONIST_LANGUAGES: Record<string, { en: string; es: string }> = {
  es: { en: 'Spanish', es: 'Español' },
  en: { en: 'English', es: 'Inglés' },
  ca: { en: 'Catalan', es: 'Catalán' },
  eu: { en: 'Basque', es: 'Euskera' },
  gl: { en: 'Galician', es: 'Gallego' },
  fr: { en: 'French', es: 'Francés' },
  pt: { en: 'Portuguese', es: 'Portugués' },
  de: { en: 'German', es: 'Alemán' },
  it: { en: 'Italian', es: 'Italiano' },
}
