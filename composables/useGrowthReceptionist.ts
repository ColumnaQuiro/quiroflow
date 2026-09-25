// The AI receptionist's configuration, read from the database.
//
// The stats the design puts across the top (conversations, booked, escalated,
// average response time) are not here: nothing has run yet, so there is
// nothing to count. They arrive with the receptionist itself.

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
}

interface TypeChoices {
  /** The clinic's active types, in its own order. What the editor lists. */
  appointmentTypes: ReceptionistType[]
  /** What the prompt is given now -- computed server-side, archived excluded. */
  offeredTypes: ReceptionistType[]
}

interface ConfigResponse extends TypeChoices {
  config: ReceptionistConfig
  channels: ReceptionistChannel[]
  testModelAvailable: boolean
}

export function useGrowthReceptionist() {
  const config = ref<ReceptionistConfig | null>(null)
  const channels = ref<ReceptionistChannel[]>([])
  const testModelAvailable = ref(false)
  const appointmentTypes = ref<ReceptionistType[]>([])
  const offeredTypes = ref<ReceptionistType[]>([])
  const loading = ref(true)
  const saving = ref(false)
  const error = ref<string | null>(null)
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
    } catch {
      error.value = t('Could not load the receptionist settings.', 'No se ha podido cargar la configuración de la recepcionista.')
    } finally {
      loading.value = false
    }
  }
  onMounted(load)

  async function save(patch: Partial<ReceptionistConfig>) {
    saving.value = true
    try {
      const data = await useStaffFetch<{ config: ReceptionistConfig } & TypeChoices>('/api/growth/receptionist/config', { method: 'PUT', body: patch })
      config.value = data.config
      appointmentTypes.value = data.appointmentTypes
      offeredTypes.value = data.offeredTypes
      showToast(t('Saved.', 'Guardado.'))
      return true
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not save.', 'No se ha podido guardar.'), 'error')
      return false
    } finally {
      saving.value = false
    }
  }

  const liveChannelCount = computed(() => channels.value.filter((c) => c.status === 'connected').length)

  return { config, channels, appointmentTypes, offeredTypes, testModelAvailable, loading, saving, error, save, liveChannelCount }
}
