import type { ReceptionistActivity } from '~/utils/receptionistActivity'

// The AI receptionist's configuration, read from the database, and what it
// has done this month (utils/receptionistActivity.ts), which the same
// request carries.

export interface KnowledgeCard {
  id: string
  title: string
  lines: string[]
  footnote?: string
}

export interface EscalationRule {
  rule: string
  action: string
}

export interface ReceptionistConfig {
  enabled: boolean
  personaName: string
  languages: string[]
  tone: string
  neverSays: string
  knowledge: KnowledgeCard[]
  qualificationQuestions: string[]
  escalationRules: EscalationRule[]
  bookingWindowDays: number
  minimumNoticeMinutes: number
  slotsPerReply: number
  bookableAppointmentTypeIds: string[]
  afterHours: boolean
  missedCallTextBack: boolean
  answerDuringHours: boolean
  noReplyPhrases: string[]
  /** Replies a month after which it writes no more; null for no ceiling. */
  monthlyReplyLimit: number | null
  /** Offered to a patient back after a long break with no bono; null for none. */
  reactivationAppointmentTypeId: string | null
  /** When the settings last changed, sent back with a save so one from a stale screen is refused. */
  updatedAt?: string | null
}

export type ChannelStatus = 'connected' | 'not_set_up' | 'not_built'

export interface ReceptionistChannel {
  /** Stable across renaming and translation, so tests can name one row. */
  key: string
  name: string
  status: ChannelStatus
  statusLabel: string
}

/** An appointment type as the receptionist screen lists it. */
export interface ReceptionistType {
  id: string
  name: string
  durationMinutes: number
  /** appointment_types.stage: what tells the receptionist a first visit from the rest. */
  stage?: string | null
  /** appointment_types.default_price_cents: the price the receptionist quotes. */
  priceCents?: number | null
}

interface TypeChoices {
  /** The clinic's active types, in its own order. What the editor lists. */
  appointmentTypes: ReceptionistType[]
  /** What the prompt is given now -- computed server-side, archived excluded. */
  offeredTypes: ReceptionistType[]
}

/** Why the account has the receptionist -- the Subscription page's reading. */
export type ReceptionistIncludedBy = 'comped' | 'trial' | 'growth' | 'addon' | null

interface ConfigResponse extends TypeChoices {
  config: ReceptionistConfig
  channels: ReceptionistChannel[]
  testModelAvailable: boolean
  repliesThisMonth: number
  includedBy?: ReceptionistIncludedBy
  activity?: ReceptionistActivity
}

export function useGrowthReceptionist() {
  const config = ref<ReceptionistConfig | null>(null)
  const channels = ref<ReceptionistChannel[]>([])
  const testModelAvailable = ref(false)
  const repliesThisMonth = ref(0)
  const includedBy = ref<ReceptionistIncludedBy>(null)
  const activity = ref<ReceptionistActivity | null>(null)
  const appointmentTypes = ref<ReceptionistType[]>([])
  const offeredTypes = ref<ReceptionistType[]>([])
  const loading = ref(true)
  const saving = ref(false)
  const error = ref<string | null>(null)
  // The server's 402: this subscription does not include the receptionist.
  // Not an error to show -- the page shows what it would take to get it. The
  // page already asks the account store first, but the store can say yes
  // where the server says no (the ?growth=1 preview flag, a plan changed in
  // another tab), and that used to surface as "Could not load the
  // receptionist settings".
  const notIncluded = ref(false)
  const { showToast } = useToast()
  const t = useT()

  async function load() {
    try {
      const data = await useStaffFetch<ConfigResponse>('/api/growth/receptionist/config')
      config.value = data.config
      appointmentTypes.value = data.appointmentTypes
      offeredTypes.value = data.offeredTypes
      channels.value = data.channels
      testModelAvailable.value = data.testModelAvailable
      repliesThisMonth.value = data.repliesThisMonth ?? 0
      includedBy.value = data.includedBy ?? null
      activity.value = data.activity ?? null
    } catch (e) {
      const status = (e as { statusCode?: number; status?: number } | null)?.statusCode ?? (e as { status?: number } | null)?.status
      if (status === 402) {
        notIncluded.value = true
        return
      }
      error.value = t('Could not load the receptionist settings.', 'No se ha podido cargar la configuración de la recepcionista.')
    } finally {
      loading.value = false
    }
  }
  onMounted(load)

  // One save at a time, each carrying the updatedAt the one before it
  // returned: two quick edits on this screen must not read as somebody else's.
  let queue: Promise<unknown> = Promise.resolve()
  function save(patch: Partial<ReceptionistConfig>): Promise<boolean> {
    const next = queue.then(() => saveNow(patch))
    queue = next
    return next
  }

  async function saveNow(patch: Partial<ReceptionistConfig>) {
    saving.value = true
    try {
      // The settings as this screen read them: a save over somebody else's
      // newer change is refused rather than writing the old cards back.
      const body = { ...patch, ifUpdatedAt: config.value?.updatedAt ?? null }
      const data = await useStaffFetch<{ config: ReceptionistConfig } & TypeChoices>('/api/growth/receptionist/config', { method: 'PUT', body })
      config.value = data.config
      appointmentTypes.value = data.appointmentTypes
      offeredTypes.value = data.offeredTypes
      showToast(t('Saved.', 'Guardado.'))
      return true
    } catch (e) {
      const stale = (e as { statusCode?: number; status?: number })?.statusCode === 409 || (e as { status?: number })?.status === 409
      showToast(
        stale
          ? t('Someone changed these settings after you opened this page. Reload it to see their changes, then save yours again.', 'Alguien ha cambiado estos ajustes después de que abrieras la página. Recárgala para ver sus cambios y vuelve a guardar los tuyos.')
          : withServerDetail(t('Could not save.', 'No se ha podido guardar.'), e, t('Details:', 'Detalle:')),
        'error',
      )
      return false
    } finally {
      saving.value = false
    }
  }

  const liveChannelCount = computed(() => channels.value.filter((c) => c.status === 'connected').length)

  return { config, channels, appointmentTypes, offeredTypes, testModelAvailable, repliesThisMonth, includedBy, activity, loading, saving, error, notIncluded, save, reload: load, liveChannelCount }
}
