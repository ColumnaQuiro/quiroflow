// QuiroFlow has no central i18n catalog/message-key system -- t(en, es) is
// called inline at each string's own call site with both variants right
// there, colocated with the component that renders it, and looked up
// against the current per-staff-member language preference (Settings >
// Appearance). This keeps every string's translation next to its English
// original instead of a giant shared locale file no one keeps in sync,
// and avoids hundreds of files fighting over the same catalog file.
export function useT() {
  const { preference } = useLang()
  return (en: string, es: string) => (preference.value === 'es' ? es : en)
}
