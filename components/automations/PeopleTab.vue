<script setup lang="ts">
import { OUTCOMES, STOP_REASONS, say } from '~/utils/automationCatalog'
import { stepTitle } from '~/utils/automationDescribe'
import { FIELD } from '~/utils/automationUi'
import { serverMessage } from '~/utils/serverMessage'
import { buildJourney, defaultJourneyStep, type CanvasJourney, type JourneyMessage, type StepJourney } from '~/utils/automationJourney'

// People: who is in this automation, where, since when, what comes next --
// and for one person, their journey step by step with Retry / Skip / Take out.
// Patients and leads alike (the Growth Executions view, for everyone).

const props = defineProps<{ initialRunId?: string | null }>()
const emit = defineEmits<{ changed: []; openRun: [id: string | null] }>()
const b = useBuilder()
const t = useT()
const { preference } = useLang()
const { showToast } = useToast()

type Tab = 'running' | 'done' | 'exited' | 'failed'
interface RunRow {
  id: string
  subject: { kind: 'patient' | 'lead'; id: string; name: string }
  status: string
  stoppedReason: string | null
  stepId: string | null
  stepLabel: string | null
  waitingFor: string | null
  waitDeadline: string | null
  resumeAt: string | null
  attempts: number
  lastError: string | null
  startedAt: string
}
interface Detail {
  run: RunRow & { ruleName: string; dryRun: boolean; currentStepId: string | null; subject: RunRow['subject'] & { contact: string | null } }
  events: { id: string; stepId: string | null; position: number | null; stepLabel: string | null; outcome: string; detail: string | null; actor: string | null; at: string }[]
  messages: JourneyMessage[]
}

const tab = ref<Tab>('running')
const stepFilter = ref('')
const runs = ref<RunRow[]>([])
const counts = ref({ running: 0, done: 0, exited: 0, failed: 0 })
const nextBefore = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

async function load(more = false) {
  if (!b.ruleId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await useStaffFetch<{ runs: RunRow[]; counts: typeof counts.value; nextBefore: string | null }>(`/api/automations/${b.ruleId.value}/runs`, {
      query: { tab: tab.value, step: stepFilter.value || undefined, before: more ? nextBefore.value : undefined },
    })
    runs.value = more ? [...runs.value, ...res.runs] : res.runs
    counts.value = res.counts
    nextBefore.value = res.nextBefore
  } catch (e) {
    error.value = serverMessage(e) ?? t('Could not load the people in this automation.', 'No se han podido cargar las personas de esta automatización.')
  } finally {
    loading.value = false
  }
}
watch([tab, stepFilter], () => load())
onMounted(async () => {
  await load()
  if (props.initialRunId) open(props.initialRunId)
})

const TABS = computed(() => [
  { key: 'running' as Tab, label: t('In progress', 'En curso'), count: counts.value.running },
  { key: 'done' as Tab, label: t('Finished', 'Terminaron'), count: counts.value.done },
  { key: 'exited' as Tab, label: t('Left', 'Salieron'), count: counts.value.exited },
  { key: 'failed' as Tab, label: t('Failed', 'Con fallos'), count: counts.value.failed },
])

const locale = computed(() => (preference.value === 'es' ? 'es-ES' : 'en-GB'))
function day(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (diff === 0) return t('today', 'hoy')
  if (diff === 1) return t('yesterday', 'ayer')
  return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
}
function sinceLabel(iso: string) {
  const d = day(iso)
  const relative = d === t('today', 'hoy') || d === t('yesterday', 'ayer')
  return relative ? t(`entered ${d}`, `entró ${d}`) : t(`entered ${d}`, `entró el ${d}`)
}
function when(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function whereLabel(r: RunRow) {
  const step = r.stepId ? b.stepsById.value.get(r.stepId) : null
  return step ? stepTitle(t, step, b.lookup.value) : (r.stepLabel ?? '—')
}
function nextLabel(r: RunRow) {
  if (r.status !== 'running') return '—'
  if (r.waitingFor && r.waitingFor !== 'delay' && r.waitDeadline) return t(`until ${when(r.waitDeadline)}`, `hasta el ${when(r.waitDeadline)}`)
  if (r.resumeAt && new Date(r.resumeAt).getTime() > Date.now()) return t(`continues ${when(r.resumeAt)}`, `sigue el ${when(r.resumeAt)}`)
  return t('any moment', 'en breve')
}
function statusTone(r: RunRow): 'info' | 'success' | 'neutral' | 'danger' {
  return r.status === 'running' ? 'info' : r.status === 'done' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'
}
function statusLabel(r: RunRow) {
  if (r.status === 'running') return t('In progress', 'En curso')
  if (r.status === 'done') return t('Finished', 'Terminó')
  if (r.status === 'failed') return t(`Failed · ${r.attempts} attempts`, `Falló · ${r.attempts} intentos`)
  return r.stoppedReason ? say(t, STOP_REASONS[r.stoppedReason] ?? [r.stoppedReason, r.stoppedReason]) : t('Left', 'Salió')
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
const personLink = (s: RunRow['subject']) => (s.kind === 'patient' ? `/patients/${s.id}` : `/growth/leads?lead=${s.id}`)

// ---- one person's journey
const selectedId = ref<string | null>(null)
const detail = ref<Detail | null>(null)
const detailLoading = ref(false)
const acting = ref<'' | 'retry' | 'skip' | 'remove'>('')
async function open(id: string) {
  selectedId.value = id
  emit('openRun', id)
  detailLoading.value = true
  try {
    detail.value = await useStaffFetch<Detail>(`/api/automations/runs/${id}`)
  } catch {
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}
function close() {
  selectedId.value = null
  detail.value = null
  emit('openRun', null)
}
async function act(kind: 'retry' | 'skip' | 'remove') {
  if (!selectedId.value) return
  acting.value = kind
  try {
    await useStaffFetch(`/api/automations/runs/${selectedId.value}/${kind}`, { method: 'POST' })
    showToast(kind === 'retry' ? t('Retried', 'Reintentado') : kind === 'skip' ? t('Moved on', 'Pasó al siguiente paso') : t('Taken out', 'Ha salido'))
    await Promise.all([open(selectedId.value), load()])
    emit('changed')
  } catch (e) {
    showToast(serverMessage(e) ?? t('That did not work.', 'No ha funcionado.'), 'error')
  } finally {
    acting.value = ''
  }
}
const live = computed(() => detail.value && (detail.value.run.status === 'running' || detail.value.run.status === 'failed'))
const stepOptions = computed(() => b.draft.value.steps.map((s) => ({ id: s.id, label: stepTitle(t, s, b.lookup.value) })))
defineExpose({ reload: () => load() })

// ---- the journey, drawn on the flow (n8n-style)
const journey = computed<Record<string, StepJourney> | null>(() => {
  if (!detail.value) return null
  return buildJourney(b.draft.value.steps, detail.value.events, detail.value.messages ?? [], detail.value.run)
})
const pickedStep = ref<string | null>(null)
watch(journey, (j) => {
  if (!j || !detail.value) return
  if (!pickedStep.value || (pickedStep.value !== 'trigger' && !j[pickedStep.value])) pickedStep.value = defaultJourneyStep(j, detail.value.run) ?? 'trigger'
})
function messageNote(m: JourneyMessage) {
  const at = when(m.openedAt ?? m.deliveredAt ?? m.at)
  switch (m.status) {
    case 'read': return t(`Read ${at}`, `Leído ${at}`)
    case 'opened': return t(`Opened ${at}`, `Abierto ${at}`)
    case 'clicked': return t(`Clicked ${when(m.clickedAt ?? m.at)}`, `Clic ${when(m.clickedAt ?? m.at)}`)
    case 'delivered': return t(`Delivered ${at}`, `Entregado ${at}`)
    case 'sent': return t(`Sent ${when(m.at)}`, `Enviado ${when(m.at)}`)
    case 'would_send':
    case 'dry_run': return t('Recorded (test mode)', 'Registrado (modo prueba)')
    case 'bounced': return t('Bounced', 'Rebotó')
    case 'failed': return t('Not delivered', 'No entregado')
    default: return m.status
  }
}
function stepNote(id: string, j: StepJourney): string {
  const step = b.stepsById.value.get(id)
  const run = detail.value!.run
  if (j.state === 'unreached') return ''
  if (j.state === 'failed') return t(`Failed · ${Math.max(run.attempts, j.events.filter((e) => e.outcome === 'failed').length) || 1} attempts`, `Falló · ${Math.max(run.attempts, j.events.filter((e) => e.outcome === 'failed').length) || 1} intentos`)
  if (j.state === 'retrying') return t(`Retrying · attempt ${run.attempts + 1} of 3`, `Reintentando · intento ${run.attempts + 1} de 3`)
  if (j.state === 'current') return t('Next', 'Siguiente')
  if (j.state === 'waiting') {
    if (step?.action_type === 'wait_until' && run.waitDeadline) return t(`Waiting · until ${when(run.waitDeadline)}`, `Esperando · hasta ${when(run.waitDeadline)}`)
    if (run.resumeAt) return t(`Until ${when(run.resumeAt)}`, `Hasta ${when(run.resumeAt)}`)
    return t('Waiting', 'Esperando')
  }
  if (j.state === 'skipped') return t('Skipped', 'Saltado')
  const last = j.messages[j.messages.length - 1]
  if (last) return messageNote(last)
  if (j.outlet === 'yes') return t('Went: Yes', 'Fue por: Sí')
  if (j.outlet === 'no') return t('Went: No', 'Fue por: No')
  if (j.outlet === 'met') return t('It happened', 'Ocurrió')
  if (j.outlet === 'timeout') return t('Not in time', 'No a tiempo')
  if (step?.action_type === 'delay') return t('Waited', 'Esperó')
  const done = [...j.events].reverse().find((e) => e.outcome === 'sent' || e.outcome === 'applied' || e.outcome === 'dry_run')
  return done ? (done.outcome === 'dry_run' ? t('Recorded (test mode)', 'Registrado (modo prueba)') : t(`Done ${when(done.at)}`, `Hecho ${when(done.at)}`)) : t('Done', 'Hecho')
}
const canvasJourney = computed<CanvasJourney | null>(() => {
  if (!journey.value || !detail.value) return null
  const steps: CanvasJourney['steps'] = {}
  for (const [id, j] of Object.entries(journey.value)) steps[id] = { state: j.state, note: stepNote(id, j), outlet: j.outlet }
  return { steps, triggerNote: t(`Entered ${when(detail.value.run.startedAt)}`, `Entró ${when(detail.value.run.startedAt)}`), picked: pickedStep.value }
})
const picked = computed(() => (pickedStep.value && pickedStep.value !== 'trigger' ? { id: pickedStep.value, step: b.stepsById.value.get(pickedStep.value) ?? null, j: journey.value?.[pickedStep.value] ?? null } : null))
const STATE_LABEL = computed<Record<string, string>>(() => ({
  ok: t('Done', 'Hecho'),
  failed: t('Failed', 'Falló'),
  retrying: t('Retrying', 'Reintentando'),
  waiting: t('Waiting here', 'Esperando aquí'),
  current: t('Next', 'Siguiente'),
  skipped: t('Skipped', 'Saltado'),
  unreached: t('Did not get here', 'No llegó aquí'),
}))
const STATE_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  ok: 'success', failed: 'danger', retrying: 'warning', waiting: 'warning', current: 'info', skipped: 'neutral', unreached: 'neutral',
}
const isPickedCurrent = computed(() => !!picked.value && detail.value?.run.currentStepId === picked.value.id)
const inboxLink = computed(() => {
  const s = detail.value?.run.subject
  if (!s) return null
  // The Inbox opens a conversation by its key (?open=): a patient's id, or lead:<id>.
  return `/inbox?open=${encodeURIComponent(s.kind === 'patient' ? s.id : `lead:${s.id}`)}`
})

</script>

<template>
  <!-- The list, or one person's journey across the whole width (n8n-style):
  the flow with each step coloured by what happened to them, and what the
  picked step did -- the message it sent, how it was delivered, why it
  failed -- with Retry / Skip / Take out. -->
  <div v-if="!selectedId" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6" data-test="people">
    <div class="flex min-w-0 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="x in TABS"
          :key="x.key"
          type="button"
          class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-11"
          :class="tab === x.key ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle'"
          :aria-pressed="tab === x.key"
          :data-test="`people-tab-${x.key}`"
          @click="tab = x.key"
        >{{ x.label }} · {{ x.count }}</button>
        <select v-model="stepFilter" :class="[FIELD, 'ml-auto w-auto max-w-[240px]']" :aria-label="t('Step', 'Paso')" data-test="people-step">
          <option value="">{{ t('At any step', 'En cualquier paso') }}</option>
          <option v-for="s in stepOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </div>

      <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
      <section v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div v-if="loading && runs.length === 0" class="flex animate-pulse flex-col gap-2 p-4" aria-hidden="true">
          <div v-for="i in 4" :key="i" class="h-10 rounded-ctl bg-surface-subtle" />
        </div>
        <p v-else-if="runs.length === 0" class="px-4 py-10 text-center text-[13px] text-ink-muted" data-test="people-empty">
          {{ counts.running + counts.done + counts.exited + counts.failed === 0
            ? t('Nobody has entered yet. An automation that only sends does so the moment it fires; people appear here once it waits, branches or does something else.', 'Aún no ha entrado nadie. Una automatización que solo envía lo hace en el momento; las personas aparecen aquí cuando espera, tiene condiciones o hace algo más.')
            : t('Nobody here.', 'Nadie aquí.') }}
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="border-b border-line-divider text-left text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">
                <th class="px-4 py-2.5">{{ t('Person', 'Persona') }}</th>
                <th class="px-2 py-2.5">{{ t('Where they are', 'Dónde está') }}</th>
                <th class="hidden px-2 py-2.5 md:table-cell">{{ t('Since', 'Desde') }}</th>
                <th class="hidden px-2 py-2.5 md:table-cell">{{ t('Next', 'Siguiente') }}</th>
                <th class="px-2 py-2.5">{{ t('Status', 'Estado') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in runs"
                :key="r.id"
                class="cursor-pointer border-b border-line-row last:border-0"
                :class="selectedId === r.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
                :data-test="`run-${r.id}`"
                @click="open(r.id)"
              >
                <td class="px-4 py-2.5">
                  <span class="flex items-center gap-2.5">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11.5px] font-bold text-brand-text">{{ initials(r.subject.name) }}</span>
                    <span class="whitespace-nowrap font-semibold text-ink-900">{{ r.subject.name }}</span>
                    <span v-if="r.subject.kind === 'lead'" class="rounded-pill bg-chip-bg px-1.5 text-[10.5px] font-semibold text-chip-text">Lead</span>
                  </span>
                </td>
                <td class="px-2 py-2.5 text-ink-700">{{ r.status === 'running' || r.status === 'failed' ? whereLabel(r) : '—' }}</td>
                <td class="hidden whitespace-nowrap px-2 py-2.5 text-ink-muted md:table-cell">{{ sinceLabel(r.startedAt) }}</td>
                <td class="hidden whitespace-nowrap px-2 py-2.5 text-ink-muted md:table-cell">{{ nextLabel(r) }}</td>
                <td class="whitespace-nowrap px-2 py-2.5"><UiPill :tone="statusTone(r)" data-test="run-status">{{ statusLabel(r) }}</UiPill></td>
              </tr>
            </tbody>
          </table>
          <div v-if="nextBefore" class="flex justify-center border-t border-line-divider py-2">
            <UiBtn size="sm" :disabled="loading" @click="load(true)">{{ t('Load more', 'Cargar más') }}</UiBtn>
          </div>
        </div>
      </section>
      <p class="text-[12px] leading-snug text-ink-muted">{{ t('"Left" are those who stopped qualifying: they asked not to be contacted, their record was deleted, or they booked and the automation ends on booking.', '«Salieron» son quienes dejaron de cumplir la automatización: pidieron no ser contactados, se borró su ficha, o reservaron y la automatización termina al reservar.') }}</p>
    </div>
  </div>

  <div v-else class="flex min-h-0 flex-1 flex-col" :aria-label="t('Their journey', 'Su recorrido')" data-test="run-detail">
    <div class="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <button type="button" class="flex h-9 items-center gap-1.5 rounded-ctl border border-line-control bg-surface px-3 text-[13px] font-semibold text-ink-700 hover:bg-surface-subtle touch:h-11" data-test="people-back" @click="close">
        <svg width="7" height="11" viewBox="0 0 8 13" fill="none" aria-hidden="true"><path d="M7 1L1 6.5L7 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        {{ t('People', 'Personas') }}
      </button>
      <template v-if="detail">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text">{{ initials(detail.run.subject.name) }}</span>
        <div class="flex min-w-0 flex-col">
          <NuxtLink :to="personLink(detail.run.subject)" class="truncate text-[15px] font-bold text-ink-900 hover:underline">{{ detail.run.subject.name }}</NuxtLink>
          <span class="truncate text-[12px] text-ink-muted">{{ detail.run.subject.kind === 'lead' ? 'Lead' : t('Patient', 'Paciente') }}<template v-if="detail.run.subject.contact"> · {{ detail.run.subject.contact }}</template> · {{ t(`entered ${when(detail.run.startedAt)}`, `entró el ${when(detail.run.startedAt)}`) }}</span>
        </div>
        <UiPill :tone="statusTone(detail.run)" data-test="run-status">{{ statusLabel(detail.run) }}</UiPill>
        <span class="flex-1" />
        <NuxtLink v-if="inboxLink" :to="inboxLink" class="flex h-9 items-center rounded-ctl px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-tint touch:h-11" data-test="run-inbox">{{ t('Open in Inbox', 'Ver en la Bandeja') }}</NuxtLink>
        <template v-if="live">
          <UiBtn v-if="detail.run.status === 'failed'" variant="primary" :disabled="!!acting" data-test="run-retry" @click="act('retry')">{{ acting === 'retry' ? t('Retrying…', 'Reintentando…') : t('Retry this step', 'Reintentar este paso') }}</UiBtn>
          <UiBtn :disabled="!!acting" data-test="run-skip" @click="act('skip')">{{ t('Skip to the next', 'Saltar al siguiente') }}</UiBtn>
          <UiBtn :disabled="!!acting" data-test="run-remove" @click="act('remove')">{{ t('Take out', 'Sacar') }}</UiBtn>
        </template>
      </template>
    </div>

    <div v-if="detailLoading && !detail" class="flex animate-pulse flex-col gap-2 p-6" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="h-10 rounded-ctl bg-surface-subtle" />
    </div>
    <template v-else-if="detail">
      <div v-if="detail.run.status === 'failed' || detail.run.dryRun" class="flex flex-col gap-2 px-4 pt-3 sm:px-6">
        <p v-if="detail.run.status === 'failed'" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] leading-snug text-warning-text [overflow-wrap:anywhere]" data-test="run-error">
          <strong>{{ t('This step could not be done:', 'No se pudo hacer este paso:') }}</strong> {{ detail.run.lastError }}
          {{ t(`After ${detail.run.attempts} attempts it stopped here. Fix the cause, then retry: nothing already sent goes out again.`, `Tras ${detail.run.attempts} intentos se ha parado aquí. Corrige la causa y reintenta: lo ya enviado no se vuelve a enviar.`) }}
        </p>
        <p v-if="detail.run.dryRun" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text">{{ t('Test mode: it records what it would send, and sends nothing.', 'Modo prueba: registra lo que enviaría y no envía nada.') }}</p>
      </div>

      <div class="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div class="relative min-h-[420px] min-w-0">
          <AutomationsFlowCanvas read-only :journey="canvasJourney" @pick="(id: string) => (pickedStep = id)" />
        </div>

        <aside class="flex min-h-0 flex-col overflow-y-auto border-l border-line bg-surface" data-test="journey-step">
          <div v-if="pickedStep === 'trigger'" class="flex flex-col gap-1 border-b border-line-divider px-5 py-4">
            <span class="text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('Trigger', 'Disparador') }}</span>
            <strong class="text-[15px] text-ink-900">{{ t(`Entered ${when(detail.run.startedAt)}`, `Entró el ${when(detail.run.startedAt)}`) }}</strong>
          </div>
          <div v-else-if="picked" class="flex flex-col gap-3 border-b border-line-divider px-5 py-4">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('Step', 'Paso') }}</span>
                <strong class="block text-[15px] leading-snug text-ink-900">{{ picked.step ? stepTitle(t, picked.step, b.lookup.value) : '—' }}</strong>
              </div>
              <UiPill v-if="picked.j" :tone="STATE_TONE[picked.j.state]" data-test="journey-step-state">{{ STATE_LABEL[picked.j.state] }}</UiPill>
            </div>

            <p v-if="picked.j?.state === 'unreached'" class="text-[13px] text-ink-muted">{{ t('They have not reached this step: it was not their path, or they have not got here yet.', 'No ha llegado a este paso: no era su camino, o todavía no ha llegado.') }}</p>

            <!-- What it sent, as it was sent. -->
            <div v-for="m in picked.j?.messages ?? []" :key="m.id" class="flex flex-col gap-2" data-test="journey-message">
              <div
                class="whitespace-pre-line rounded-card rounded-tl-[3px] border px-3 py-2.5 text-[13px] leading-relaxed text-ink-900 [overflow-wrap:anywhere]"
                :class="m.status === 'failed' || m.status === 'bounced' ? 'border-danger-border bg-danger-bg' : m.channel === 'whatsapp' ? 'border-success-border bg-success-bg' : 'border-line bg-surface-subtle'"
              >
                <template v-if="m.channel === 'email'"><strong class="block">{{ m.subject }}</strong></template>
                <template v-if="m.body">{{ m.body }}</template>
                <span v-else-if="m.channel === 'whatsapp'" class="italic text-ink-muted">{{ t(`Template «${m.templateName}». Its text was not kept with this message (sent before 27 Sep, or Meta's copy of the template could not be read).`, `Plantilla «${m.templateName}». Su texto no se guardó con este mensaje (enviado antes del 27 sep, o no se pudo leer la plantilla en Meta).`) }}</span>
              </div>
              <ol class="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                <li>{{ m.status === 'would_send' || m.status === 'dry_run' ? t('Recorded', 'Registrado') : t('Sent', 'Enviado') }} {{ when(m.at) }}</li>
                <li v-if="m.deliveredAt">{{ t('Delivered', 'Entregado') }} {{ when(m.deliveredAt) }}</li>
                <li v-if="m.openedAt">{{ m.channel === 'whatsapp' ? t('Read', 'Leído') : t('Opened', 'Abierto') }} {{ when(m.openedAt) }}</li>
                <li v-if="m.clickedAt">{{ t('Clicked', 'Clic') }} {{ when(m.clickedAt) }}</li>
              </ol>
              <p v-if="m.error" class="text-[12px] text-danger-text [overflow-wrap:anywhere]" data-test="journey-message-error">{{ m.error }}</p>
            </div>

            <!-- Every attempt at this step, with why. -->
            <ol v-if="picked.j?.events.length" class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
              <li v-for="e in picked.j.events" :key="e.id" class="text-[12.5px] leading-snug" :class="e.outcome === 'failed' ? 'text-danger-text' : 'text-ink-700'">
                <strong>{{ when(e.at) }}</strong> · {{ say(t, OUTCOMES[e.outcome] ?? [e.outcome, e.outcome]) }}
                <span v-if="e.detail" class="block text-[11.5px] text-ink-muted [overflow-wrap:anywhere]">{{ e.detail }}</span>
                <span v-if="e.actor" class="block text-[11.5px] text-ink-muted">{{ t(`by ${e.actor}`, `por ${e.actor}`) }}</span>
              </li>
            </ol>

            <div v-if="live && isPickedCurrent" class="flex flex-wrap gap-2">
              <UiBtn v-if="detail.run.status === 'failed'" size="sm" variant="primary" :disabled="!!acting" data-test="journey-retry" @click="act('retry')">{{ t('Retry this step', 'Reintentar este paso') }}</UiBtn>
              <UiBtn size="sm" :disabled="!!acting" @click="act('skip')">{{ t('Skip it', 'Saltarlo') }}</UiBtn>
            </div>
          </div>

          <details class="px-5 py-4" open>
            <summary class="cursor-pointer text-[12.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('Whole journey', 'Todo el recorrido') }}</summary>
            <ol class="mt-3 flex flex-col gap-2" data-test="run-events">
              <li v-for="e in detail.events" :key="e.id" class="text-[12.5px] leading-snug" :class="e.outcome === 'failed' ? 'text-danger-text' : 'text-ink-700'" :data-test="`run-event-${e.outcome}`">
                <strong>{{ when(e.at) }}</strong> ·
                {{ e.stepLabel ?? say(t, OUTCOMES[e.outcome] ?? [e.outcome, e.outcome]) }}
                <span v-if="e.stepLabel" class="text-ink-muted"> · {{ say(t, OUTCOMES[e.outcome] ?? [e.outcome, e.outcome]) }}</span>
                <span v-if="e.detail" class="block text-[11.5px] text-ink-muted [overflow-wrap:anywhere]">{{ e.detail }}</span>
                <span v-if="e.actor" class="block text-[11.5px] text-ink-muted">{{ t(`by ${e.actor}`, `por ${e.actor}`) }}</span>
              </li>
            </ol>
          </details>
        </aside>
      </div>
    </template>
  </div>
</template>
