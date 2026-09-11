// The clinic code the web portal signs a patient in under. Same code the
// mobile app asks for on mobile/pages/join.vue, stored under the same
// `clinic_slug` key, and it exists for the same reason: a patient's email
// is only unique *within* a clinic, so claim_patient_profile() needs to be
// told which clinic's record to link (see composables/useIdentity.ts and
// supabase/migrations/0086_claim_patient_profile_account_scoped.sql --
// without a slug it refuses outright when the email matches at more than
// one practice).
//
// Web can't use the app's one-time gate screen: a browser is shared, its
// storage gets cleared, and a patient may arrive by a link rather than by
// installing anything. So the code lives on the sign-in form itself, with
// what was used last time (or ?clinic= from the clinic's own link)
// prefilled, rather than behind a separate step.
const STORAGE_KEY = 'clinic_slug'

export function useClinicCode() {
  const supabase = useSupabaseClient()
  const route = useRoute()

  const code = ref('')
  const clinicName = ref('')

  function normalize(value: string) {
    return value.trim().toLowerCase()
  }

  function stored(): string {
    if (import.meta.server) return ''
    return localStorage.getItem(STORAGE_KEY) ?? ''
  }

  // A clinic linking patients straight to the portal shouldn't have to
  // explain the code at all -- ?clinic=their-slug fills it in. It wins over
  // the stored value: following a specific clinic's link is a clearer
  // statement of intent than whatever this browser did last.
  function prefill() {
    const fromQuery = typeof route.query.clinic === 'string' ? route.query.clinic : ''
    code.value = normalize(fromQuery || stored())
  }

  // Resolves the code to the clinic's name so the patient can see they
  // typed it right before they hand over a password. Throws on an unknown
  // code, which is the only failure worth distinguishing here.
  async function resolve(): Promise<string> {
    const slug = normalize(code.value)
    if (!slug) throw new Error('empty')
    const { data, error } = await supabase.rpc('get_clinic_by_code', { p_slug: slug })
    if (error || !data) throw new Error('unknown')
    clinicName.value = (data as { name: string }).name
    return slug
  }

  function remember(slug: string) {
    if (!import.meta.server) localStorage.setItem(STORAGE_KEY, slug)
  }

  return { code, clinicName, prefill, resolve, remember, normalize }
}
