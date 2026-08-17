export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/portal')) return
  if (['/portal/login', '/portal/signup'].includes(to.path)) return

  const user = useSupabaseUser()
  if (!user.value) return navigateTo('/portal/login')

  const supabase = useSupabaseClient()
  const { data: patient } = await supabase.from('patients').select('id').eq('user_id', user.value.sub).maybeSingle()

  if (!patient) {
    const { error } = await supabase.rpc('claim_patient_profile')
    if (error) {
      return navigateTo('/portal/not-found')
    }
  }
})
