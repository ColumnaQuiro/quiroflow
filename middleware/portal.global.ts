export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/portal')) return
  // not-found is where a failed claim lands; re-running the claim on it
  // would just redirect it to itself.
  if (['/portal/login', '/portal/signup', '/portal/not-found'].includes(to.path)) return

  const user = useSupabaseUser()
  if (!user.value) return navigateTo('/portal/login')

  const supabase = useSupabaseClient()
  const { data: patient } = await supabase.from('patients').select('id').eq('user_id', user.value.sub).maybeSingle()

  if (!patient) {
    // Scoped to the clinic code entered on the sign-in form (see
    // composables/useClinicCode.ts). A patient's email is only unique
    // within one clinic, so without the slug claim_patient_profile()
    // refuses outright as soon as the same email exists at two practices.
    const slug = import.meta.client ? (localStorage.getItem('clinic_slug') ?? undefined) : undefined
    let { error } = await supabase.rpc('claim_patient_profile', { p_account_slug: slug })
    // A code for the wrong clinic shouldn't be a dead end when the email
    // itself is unambiguous: retry unscoped, which still refuses when the
    // email matches at more than one clinic -- the case the code is for.
    if (error && slug) ({ error } = await supabase.rpc('claim_patient_profile'))
    if (error) {
      return navigateTo('/portal/not-found')
    }
  }
})
