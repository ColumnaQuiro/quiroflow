// The patient app's guided tour (components/PatientAppTour.vue): five steps
// over Inicio, each lighting up one thing -- the next visit, Plan, the money
// tiles, Documentos and Cuidarme -- with a sentence and "Siguiente".
//
// It runs once per person and device, the first time they reach Inicio, and
// again whenever they ask for it from Cuenta. "Seen" is kept on the phone,
// not in the database: a column on patients would have to be carried by
// merge_patients, anonymize_patient and the two-factor policy for what is a
// courtesy, and seeing it once more on a new phone does no harm. Unlike the
// Face ID offer it survives signing out: the tour is about the app, not the
// session.
const SEEN_PREFIX = 'patient_tour_seen:'

export function usePatientAppTour() {
  const user = useSupabaseUser()
  const userId = () => user.value?.sub ?? user.value?.id ?? ''

  /** The tour is on screen. Read by the Face ID offer, so the two never stack. */
  const open = useState('patient-tour-open', () => false)
  /** Asked for from Cuenta: run it on Inicio even though it has been seen. */
  const requested = useState('patient-tour-requested', () => false)

  function seen() {
    const id = userId()
    if (!id) return true
    try {
      return localStorage.getItem(SEEN_PREFIX + id) === '1'
    } catch {
      return true
    }
  }

  function markSeen() {
    const id = userId()
    if (!id) return
    try {
      localStorage.setItem(SEEN_PREFIX + id, '1')
    } catch {
      // Private storage unavailable: it will simply be offered again.
    }
  }

  function replay() {
    requested.value = true
    return navigateTo('/')
  }

  return { open, requested, seen, markSeen, replay }
}

/** Inicio has its figures in (PatientHome.vue), so the steps light up real ones, not skeletons. */
export function usePatientHomeReady() {
  return useState('patient-home-ready', () => false)
}
