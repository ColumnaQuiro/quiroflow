// Family accounts: the people this login may act for, and which one the app
// or the portal is showing now.
//
// The list is get_my_family() (20261106053857_family_accounts.sql): me, and
// everybody the clinic has linked to me in patient_managers. The DATABASE
// decides who is on it -- every patient-side policy reads
// patients_i_can_act_for() -- so choosing somebody here only picks whose
// screen to show. An id that is not in the list shows nothing, because
// nothing comes back for it.
//
// The active person is remembered per device: a cookie, so the server-rendered
// portal renders the same person the browser will, and localStorage beside it
// for the app, where the webview's cookie jar is not something to rely on.
// Shared through useState, like usePortalPatient and for the same reason: per
// request on the server, app-wide in the browser.
export type FamilyAccess = 'self' | 'full' | 'admin'

export interface FamilyPerson {
  patientId: string
  accountId: string
  clinicName: string
  firstName: string
  lastName: string | null
  gender: string | null
  isSelf: boolean
  /** 'admin': visits, booking, payments and invoices only -- no clinical content. */
  access: FamilyAccess
  basis: 'guardian' | 'consent' | null
  /** What they are to me, from the ficha's Familia card: 'child', 'partner'... */
  relation: string | null
  /** The patient_managers row, for letting go of it; null for me. */
  linkId: string | null
}

const STORAGE_KEY = 'qf_acting'

function readStored(): string | null {
  if (!import.meta.client) return null
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(id: string | null) {
  if (!import.meta.client) return
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: the cookie still carries it for this session.
  }
}

export function personName(p: Pick<FamilyPerson, 'firstName' | 'lastName'> | null | undefined) {
  return [p?.firstName, p?.lastName].filter(Boolean).join(' ')
}

export function personInitials(p: Pick<FamilyPerson, 'firstName' | 'lastName'> | null | undefined) {
  return [p?.firstName?.[0], p?.lastName?.[0]].filter(Boolean).join('').toUpperCase()
}

export function useFamily() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const people = useState<FamilyPerson[]>('family-people', () => [])
  const loadedFor = useState<string | null>('family-loaded-for', () => null)
  const loading = useState('family-loading', () => false)
  const loadError = useState('family-error', () => '')
  const cookie = useCookie<string | null>(STORAGE_KEY, { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, default: () => null })
  const activeId = useState<string | null>('family-active', () => cookie.value ?? readStored())

  // Every screen asks; one request answers them all. Kept on the Nuxt app
  // (per request on the server, app-wide in the browser), not in useState,
  // which must stay serialisable for the server-rendered payload.
  const nuxtApp = useNuxtApp() as unknown as { _familyLoad?: Promise<void> | null }
  function load(force = false): Promise<void> {
    if (nuxtApp._familyLoad && !force) return nuxtApp._familyLoad
    const run = doLoad(force).finally(() => {
      if (nuxtApp._familyLoad === run) nuxtApp._familyLoad = null
    })
    nuxtApp._familyLoad = run
    return run
  }

  async function doLoad(force: boolean) {
    const userId = user.value?.sub ?? null
    if (!userId) {
      people.value = []
      loadedFor.value = null
      return
    }
    if (!force && loadedFor.value === userId) return
    if (loadedFor.value !== userId) people.value = []
    loading.value = true
    loadError.value = ''
    const { data, error } = await supabase.rpc('get_my_family')
    loading.value = false
    if (error) {
      loadError.value = error.message
      // Fails to "just me": the screens fall back to the login's own record.
      people.value = []
      loadedFor.value = null
      return
    }
    people.value = (data ?? []).map((r) => ({
      patientId: r.patient_id,
      accountId: r.account_id,
      clinicName: r.clinic_name,
      firstName: r.first_name,
      lastName: r.last_name,
      gender: r.gender,
      isSelf: r.is_self,
      access: (r.access as FamilyAccess) ?? 'self',
      basis: (r.basis as FamilyPerson['basis']) ?? null,
      relation: r.relation,
      linkId: r.link_id,
    }))
    loadedFor.value = userId
    // Somebody remembered from before who is no longer on the list (the link
    // was withdrawn, or they turned 16): back to my own record.
    if (activeId.value && !people.value.some((p) => p.patientId === activeId.value)) setActive(null)
    else if (active.value && !active.value.isSelf) logOpened(active.value.patientId)
  }

  const me = computed(() => people.value.find((p) => p.isSelf) ?? null)
  const others = computed(() => people.value.filter((p) => !p.isSelf))
  const active = computed(() => people.value.find((p) => p.patientId === activeId.value) ?? me.value)
  const actingForOther = computed(() => Boolean(active.value && !active.value.isSelf))
  /** Documents, exercises, progress, learn, habits and messages. */
  const canSeeClinical = computed(() => active.value?.access !== 'admin')
  const hasFamily = computed(() => others.value.length > 0)

  function setActive(id: string | null) {
    const value = id && id !== me.value?.patientId ? id : null
    activeId.value = value
    cookie.value = value
    writeStored(value)
  }

  // Settings > Activity log: a family member opening somebody's record is
  // listed as such (log_family_access does nothing for my own record).
  function logOpened(patientId: string) {
    supabase.rpc('log_family_access', { p_patient_id: patientId, p_kind: 'record_opened' }).then(({ error }) => {
      if (error) console.warn('[family] could not log the access', error.message)
    })
  }

  // A notification tapped about somebody (mobile/composables/usePushNotifications.ts),
  // possibly before the list has loaded: remembered now, checked by load().
  function preferActive(patientId: string) {
    if (people.value.length) return switchTo(patientId)
    setActive(patientId)
  }

  function switchTo(patientId: string) {
    const person = people.value.find((p) => p.patientId === patientId)
    if (!person) return
    setActive(person.patientId)
    if (!person.isSelf) logOpened(person.patientId)
  }

  watch(user, (u, before) => {
    if (u?.sub !== before?.sub) {
      if (!u) setActive(null)
      load()
    }
  })

  return { people, me, others, active, actingForOther, canSeeClinical, hasFamily, loading, loadError, load, reload: () => load(true), switchTo, preferActive }
}

/**
 * How the person is introduced: "Lucas · hijo". The relation word is the
 * ficha's own (utils/familyRelations.ts), by the person's recorded sex.
 */
export function familyRelationWord(person: Pick<FamilyPerson, 'relation' | 'gender' | 'basis'>, t: (en: string, es: string) => string): string | null {
  if (person.relation) return relationLabel(person.relation, person.gender, t).toLowerCase()
  if (person.basis === 'guardian') return t('in your care', 'a tu cargo')
  return null
}
