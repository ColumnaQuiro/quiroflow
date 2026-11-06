// The signed-in patient, resolved once for the whole portal.
//
// Every card used to run its own `patients where user_id = auth.uid()`
// query, so a page with four of them made four identical round trips and
// each one rendered its own loading state at its own moment. The shell
// needs the same row anyway (the sidebar greets them by name), so it is
// resolved here and shared.
//
// Shared through useState, not module-level refs. The portal is server
// rendered, and module state on the server lives for the whole process: a
// request rendered while another patient's row was still in it put THAT
// patient's name and initials into this patient's HTML (the sidebar renders
// them with no loading check). useState is per request on the server and
// shared app-wide in the browser, which is what "resolved once for the
// whole portal" needed. It stays reactive to the signed-in user, so a
// sign-out clears it.
export interface PortalPatient {
  id: string
  first_name: string
  last_name: string | null
}

export function usePortalPatient() {
  const user = useSupabaseUser()
  const family = useFamily()
  const loading = useState('portal-patient-loading', () => true)
  const loadError = useState('portal-patient-error', () => '')

  // Family accounts (composables/useFamily.ts): the person shown is whoever
  // is chosen in the switcher, my own record unless I picked somebody else.
  // get_my_family() is the one read; it returns my own row first.
  async function load(force = false) {
    if (!user.value?.sub) {
      loading.value = false
      return
    }
    loading.value = !family.people.value.length || force
    loadError.value = ''
    await family.load(force)
    loadError.value = family.loadError.value
    loading.value = false
  }

  watch(user, () => load(), { immediate: true })

  const patient = computed<PortalPatient | null>(() => {
    const a = family.active.value
    return a ? { id: a.patientId, first_name: a.firstName, last_name: a.lastName } : null
  })
  const me = computed<PortalPatient | null>(() => {
    const m = family.me.value
    return m ? { id: m.patientId, first_name: m.firstName, last_name: m.lastName } : null
  })
  const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))
  const initials = computed(() =>
    [patient.value?.first_name?.[0], patient.value?.last_name?.[0]].filter(Boolean).join('').toUpperCase(),
  )

  return {
    patient,
    me,
    fullName,
    initials,
    loading,
    loadError,
    actingForOther: family.actingForOther,
    canSeeClinical: family.canSeeClinical,
    reload: () => load(true),
  }
}
