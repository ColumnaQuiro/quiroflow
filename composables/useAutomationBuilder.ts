import type { InjectionKey } from 'vue'
import { OUTLETS, isLeadTrigger } from '~/utils/automationCatalog'
import { chainOf, findProblems, newStepId, normalizePositions, subtreeIds, type DraftRule, type DraftStep, type Problem } from '~/utils/automationTree'
import { emptyLookup, type NameLookup } from '~/utils/automationDescribe'
import type { InsertPoint } from '~/utils/automationLayout'
import { serverMessage } from '~/utils/serverMessage'
import { answerKey, leadAnswersFromEvents } from '~/utils/automationFields'

// The state of the automation builder: the rule and its tree as they are on
// screen, what they were when loaded (so "unsaved changes" means something),
// an undo history, and the one Save that writes it all.
//
// Created once by pages/automations/[id].vue and handed to every panel with
// provide/inject, so the canvas, the inspector and the settings tab edit the
// same draft.

export interface RuleStepStats {
  here: number
  failedHere: number
  applied: number
  yes: number
  no: number
  met: number
  timedOut: number
  failed: number
  whatsapp: { sent: number; delivered: number; read: number; failed: number; recorded: number }
  email: { sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; recorded: number }
}
export interface RuleTotals {
  inside: number
  failedRuns: number
  entered: number
  converted: number
  whatsapp: RuleStepStats['whatsapp']
  email: RuleStepStats['email']
}

export interface WhatsAppTemplate {
  name: string
  language: string
  category: string
  status: string
  bodyText: string
  headerText: string | null
  variableCount: number
  urlButtonCount: number
  mediaHeaderFormat: string | null
  buttons?: { type: string; text: string; dynamic: boolean }[]
}

interface Draft {
  rule: DraftRule
  enabled: boolean
  steps: DraftStep[]
}

export type Selection = { kind: 'trigger' } | { kind: 'step'; id: string } | { kind: 'insert'; point: InsertPoint } | null

const blankRule = (): DraftRule => ({
  name: '',
  trigger_event: 'appointment.completed',
  filters: {},
  is_marketing: false,
  dry_run: false,
  entry_mode: 'every_time',
  exit_on: [],
  quiet_hours: null,
  segment: null,
})

export function defaultConfig(type: string): Record<string, any> {
  switch (type) {
    case 'whatsapp_template':
      return { template_name: '', template_language: 'es', variables: [], doc_template_ids: [] }
    case 'email':
      return { subject: '', body: '' }
    case 'webhook':
      return { url: '', secret: null }
    case 'delay':
      return { delay_minutes: 1440 }
    case 'wait_until':
      return { event: 'appointment.booked', timeout_minutes: 7 * 1440 }
    case 'branch':
      return { title: '', match: 'all', conditions: [] }
    case 'tag':
      return { mode: 'add', tag: '' }
    case 'notify':
      return { to: {}, title: '' }
    case 'lead_stage':
      return { stage: 'contacted' }
    case 'lead_assign':
      return { team_member_id: null }
    default:
      return {}
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function useAutomationBuilder() {
  const t = useT()
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  const ruleId = ref<string | null>(null)
  const draft = ref<Draft>({ rule: blankRule(), enabled: false, steps: [] })
  const original = ref('')
  const loaded = ref(false)
  const missing = ref(false)
  const loadError = ref('')
  const saving = ref(false)
  const savedAt = ref<number | null>(null)
  const createdAt = ref<string | null>(null)

  const stats = ref<{ rule: RuleTotals | null; steps: Record<string, RuleStepStats> }>({ rule: null, steps: {} })
  const canReadWhatsApp = ref(true)
  const hasGrowth = ref(true)
  const delayNowWaits = ref(false)

  const lookup = ref<NameLookup>(emptyLookup())
  const templates = ref<WhatsAppTemplate[]>([])
  const templatesError = ref('')
  const docTemplates = ref<{ id: string; title: string }[]>([])
  // The questions leads have answered on their forms, newest wording first --
  // each one a variable a lead automation can fill ({{answer_…}}).
  const leadQuestions = ref<{ key: string; question: string }[]>([])

  const selection = ref<Selection>({ kind: 'trigger' })

  const snapshot = () => JSON.stringify(draft.value)
  const dirty = computed(() => loaded.value && snapshot() !== original.value)
  const isLead = computed(() => isLeadTrigger(draft.value.rule.trigger_event))
  const stepsById = computed(() => new Map(draft.value.steps.map((s) => [s.id, s])))

  /** Steps added, removed or changed since the last save -- "you have changes in 2 steps". */
  const changedStepCount = computed(() => {
    if (!original.value) return 0
    const before = (JSON.parse(original.value) as Draft).steps
    const beforeById = new Map(before.map((s) => [s.id, JSON.stringify(s)]))
    let n = 0
    for (const s of draft.value.steps) if (beforeById.get(s.id) !== JSON.stringify(s)) n++
    for (const s of before) if (!stepsById.value.has(s.id)) n++
    return n
  })

  /** A step as it was when last saved -- for naming one the draft has removed. */
  function savedStep(id: string): DraftStep | null {
    if (!original.value) return null
    return ((JSON.parse(original.value) as Draft).steps.find((s) => s.id === id) ?? null)
  }

  const problems = computed<Problem[]>(() => findProblems(draft.value.rule, draft.value.steps, templatesError.value ? null : templates.value.length ? (templates.value as never) : null))

  // ------------------------------------------------------------ undo
  const history = ref<string[]>([])
  let lastState = ''
  let historyTimer: ReturnType<typeof setTimeout> | undefined
  let restoring = false
  watch(
    draft,
    () => {
      if (!loaded.value || restoring) return
      clearTimeout(historyTimer)
      // Typing a subject is one step of undo, not one per letter.
      historyTimer = setTimeout(() => {
        const now = snapshot()
        if (lastState && now !== lastState) {
          history.value.push(lastState)
          if (history.value.length > 60) history.value.shift()
        }
        lastState = now
      }, 400)
    },
    { deep: true },
  )
  const canUndo = computed(() => history.value.length > 0)
  function undo() {
    clearTimeout(historyTimer)
    const current = snapshot()
    // A change still inside the debounce window is undone first.
    const previous = current !== lastState && lastState ? lastState : history.value.pop()
    if (!previous) return
    restoring = true
    draft.value = JSON.parse(previous)
    lastState = previous
    nextTick(() => (restoring = false))
    if (selection.value?.kind === 'step' && !stepsById.value.has(selection.value.id)) selection.value = { kind: 'trigger' }
  }

  function resetBaseline() {
    original.value = snapshot()
    lastState = original.value
    history.value = []
  }

  // ------------------------------------------------------------ loading
  async function loadLookups() {
    const [types, members, roles, memberships, docs, forms] = await Promise.all([
      supabase.from('appointment_types').select('id, name, archived_at').order('name'),
      supabase.from('team_members').select('id, full_name, is_practitioner').is('deleted_at', null).order('full_name'),
      supabase.from('account_roles').select('id, name').order('name'),
      supabase.from('memberships').select('id, name').order('name'),
      supabase.from('doc_templates').select('id, title').order('title'),
      // Recent form submissions are enough to know which questions the
      // clinic's forms ask; there is no catalogue of them anywhere else.
      supabase.from('lead_events').select('body').eq('account_id', store.accountId ?? '').eq('kind', 'qualification').order('occurred_at', { ascending: false }).limit(300),
    ])
    lookup.value = {
      ...lookup.value,
      appointmentTypes: ((types.data ?? []) as { id: string; name: string }[]),
      members: (members.data ?? []) as { id: string; full_name: string }[],
      practitioners: ((members.data ?? []) as { id: string; full_name: string; is_practitioner: boolean }[]).filter((m) => m.is_practitioner),
      roles: (roles.data ?? []) as { id: string; name: string }[],
      memberships: (memberships.data ?? []) as { id: string; name: string }[],
      clinics: store.clinics.map((c) => ({ id: c.id, name: c.name })),
    }
    docTemplates.value = (docs.data ?? []) as { id: string; title: string }[]
    const questions = new Map<string, string>()
    for (const a of leadAnswersFromEvents((forms.data ?? []) as { body: unknown }[])) {
      const key = answerKey(a.question)
      if (key && !questions.has(key)) questions.set(key, a.question)
    }
    leadQuestions.value = [...questions].map(([key, question]) => ({ key, question }))
  }

  async function loadTemplates() {
    try {
      const res = await useStaffFetch<{ templates: WhatsAppTemplate[] }>('/api/whatsapp/templates')
      templates.value = res.templates
      templatesError.value = ''
      lookup.value = { ...lookup.value, templates: res.templates }
    } catch (e) {
      templatesError.value = serverMessage(e) ?? t('Could not load the WhatsApp templates.', 'No se han podido cargar las plantillas de WhatsApp.')
    }
  }

  async function load(id: string) {
    ruleId.value = id
    loaded.value = false
    missing.value = false
    try {
      const res = await useStaffFetch<{
        rule: DraftRule & { id: string; enabled: boolean; created_at: string }
        steps: DraftStep[]
        stats: { rule: RuleTotals; steps: Record<string, RuleStepStats> }
        canReadWhatsApp: boolean
        hasGrowth: boolean
        delayNowWaits: boolean
      }>(`/api/automations/${id}`)
      const { id: _id, enabled, created_at, ...rest } = res.rule as any
      draft.value = {
        rule: {
          name: rest.name ?? '',
          trigger_event: rest.trigger_event,
          filters: rest.filters ?? {},
          is_marketing: rest.is_marketing ?? false,
          dry_run: rest.dry_run ?? false,
          entry_mode: rest.entry_mode ?? 'every_time',
          exit_on: rest.exit_on ?? [],
          quiet_hours: rest.quiet_hours ?? null,
          segment: rest.segment ?? null,
        },
        enabled,
        steps: normalizePositions(res.steps.map((s) => ({ id: s.id, action_type: s.action_type, config: s.config ?? {}, parent_id: s.parent_id ?? null, branch: s.branch ?? null, position: s.position }))),
      }
      createdAt.value = created_at
      stats.value = res.stats
      canReadWhatsApp.value = res.canReadWhatsApp
      hasGrowth.value = res.hasGrowth
      delayNowWaits.value = res.delayNowWaits
      loaded.value = true
      resetBaseline()
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.response?.status === 404) missing.value = true
      else loadError.value = serverMessage(e) ?? t('Could not load this automation.', 'No se ha podido cargar esta automatización.')
    }
  }

  function initNew(from?: { rule: DraftRule; steps: DraftStep[] }) {
    ruleId.value = null
    draft.value = from ? { rule: clone(from.rule), enabled: false, steps: normalizePositions(clone(from.steps)) } : { rule: { ...blankRule(), name: t('New automation', 'Nueva automatización') }, enabled: false, steps: [] }
    stats.value = { rule: null, steps: {} }
    hasGrowth.value = store.hasGrowthAddon
    loaded.value = true
    // Unsaved by definition (isNew), but not "changed" until something is.
    resetBaseline()
  }
  const isNew = computed(() => !ruleId.value)

  // ------------------------------------------------------------ editing
  function updateRule(patch: Partial<DraftRule>) {
    draft.value.rule = { ...draft.value.rule, ...patch }
  }
  function updateStepConfig(id: string, patch: Record<string, any>) {
    const step = draft.value.steps.find((s) => s.id === id)
    if (step) step.config = { ...step.config, ...patch }
  }
  function replaceStepConfig(id: string, config: Record<string, any>) {
    const step = draft.value.steps.find((s) => s.id === id)
    if (step) step.config = config
  }

  /**
   * A new step at a "+". A condition or a wait put in the middle of a chain
   * takes what followed it into its first path (Yes / It happened): nothing
   * can follow a fork in its own chain.
   */
  function addStep(point: InsertPoint, type: string) {
    const id = newStepId()
    const steps = draft.value.steps
    const chain = chainOf(steps, point.parentId, point.branch)
    const outlets = OUTLETS[type]
    const moved = outlets ? chain.filter((s) => s.position >= point.index) : []
    for (const s of chain) if (s.position >= point.index && !moved.includes(s)) s.position += 1
    moved.forEach((s, i) => {
      s.parent_id = id
      s.branch = outlets![0]
      s.position = i
    })
    steps.push({ id, action_type: type, config: defaultConfig(type), parent_id: point.parentId, branch: point.branch, position: point.index })
    draft.value.steps = normalizePositions(steps)
    selection.value = { kind: 'step', id }
    return id
  }

  function removeStep(id: string) {
    const gone = subtreeIds(draft.value.steps, id)
    draft.value.steps = normalizePositions(draft.value.steps.filter((s) => !gone.has(s.id)))
    selection.value = { kind: 'trigger' }
  }

  function duplicateStep(id: string) {
    const step = stepsById.value.get(id)
    if (!step || OUTLETS[step.action_type]) return
    const copyId = newStepId()
    for (const s of chainOf(draft.value.steps, step.parent_id, step.branch)) if (s.position > step.position) s.position += 1
    draft.value.steps.push({ ...clone(step), id: copyId, position: step.position + 1 })
    draft.value.steps = normalizePositions(draft.value.steps)
    selection.value = { kind: 'step', id: copyId }
  }

  /** Steps that only make sense in a lead rule go when the trigger stops being one. */
  function setTrigger(event: string) {
    const wasLead = isLead.value
    updateRule({ trigger_event: event, ...(event === 'lead.created' ? { entry_mode: 'once_ever' } : {}) })
    if (event === 'segment' && !draft.value.rule.segment) {
      updateRule({ segment: { filters: {}, schedule: { kind: 'weekly', weekday: 1, time: '10:00' }, reentry_days: null }, entry_mode: 'once_ever' })
    }
    if (event !== 'segment' && draft.value.rule.segment) updateRule({ segment: null })
    if (wasLead && !isLeadTrigger(event)) {
      for (const s of draft.value.steps.filter((x) => x.action_type === 'lead_stage' || x.action_type === 'lead_assign')) removeStep(s.id)
      updateRule({ exit_on: draft.value.rule.exit_on.filter((e) => e !== 'lead.converted') })
    }
  }

  // ------------------------------------------------------------ saving
  type SaveOutcome =
    | { ok: true }
    | { ok: false; people: { stepId: string; actionType: string; count: number }[] }
    | { ok: false; problems: Problem[] }
    | { ok: false; error: string }

  async function save(opts: { enabled?: boolean; removedPolicy?: 'move_on' | 'take_out' } = {}): Promise<SaveOutcome> {
    saving.value = true
    const enabled = opts.enabled ?? draft.value.enabled
    const body = { rule: draft.value.rule, steps: draft.value.steps, enabled, removedPolicy: opts.removedPolicy }
    try {
      if (!ruleId.value) {
        const res = await useStaffFetch<{ id: string }>('/api/automations', { method: 'POST', body })
        ruleId.value = res.id
      } else {
        await useStaffFetch(`/api/automations/${ruleId.value}`, { method: 'PUT', body })
      }
      draft.value.enabled = enabled
      savedAt.value = Date.now()
      const selected = selection.value
      await load(ruleId.value!)
      selection.value = selected?.kind === 'step' && !stepsById.value.has(selected.id) ? { kind: 'trigger' } : selected
      return { ok: true }
    } catch (e: any) {
      const status = e?.statusCode ?? e?.response?.status
      const data = e?.data?.data
      if (status === 409 && data?.people) return { ok: false, people: data.people }
      if (status === 422 && data?.problems) return { ok: false, problems: data.problems }
      return { ok: false, error: serverMessage(e) ?? t('Could not save.', 'No se ha podido guardar.') }
    } finally {
      saving.value = false
    }
  }

  function discard() {
    if (!original.value) return
    restoring = true
    draft.value = JSON.parse(original.value)
    nextTick(() => (restoring = false))
    resetBaseline()
    if (selection.value?.kind === 'step' && !stepsById.value.has(selection.value.id)) selection.value = { kind: 'trigger' }
  }

  return {
    ruleId,
    isNew,
    draft,
    loaded,
    missing,
    loadError,
    saving,
    savedAt,
    createdAt,
    stats,
    canReadWhatsApp,
    hasGrowth,
    delayNowWaits,
    lookup,
    templates,
    templatesError,
    docTemplates,
    leadQuestions,
    selection,
    dirty,
    isLead,
    stepsById,
    changedStepCount,
    savedStep,
    problems,
    canUndo,
    undo,
    loadLookups,
    loadTemplates,
    load,
    initNew,
    updateRule,
    updateStepConfig,
    replaceStepConfig,
    addStep,
    removeStep,
    duplicateStep,
    setTrigger,
    save,
    discard,
  }
}

export type AutomationBuilder = ReturnType<typeof useAutomationBuilder>
export const BUILDER_KEY: InjectionKey<AutomationBuilder> = Symbol('automation-builder')

export function useBuilder(): AutomationBuilder {
  const builder = inject(BUILDER_KEY)
  if (!builder) throw new Error('useBuilder() outside the automation builder')
  return builder
}
