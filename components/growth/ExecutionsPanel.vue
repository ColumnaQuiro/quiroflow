<script setup lang="ts">
import type { ExecutionEvent, RunStatus } from '~/composables/useGrowthExecutions'

// Growth > Automations > Executions. Every run of a lead automation, what
// each step did, and Retry for the ones that failed -- the view n8n gave the
// clinic before the drip moved in-app.

const props = defineProps<{
  workflows: { id: string; name: string }[]
  /** Opened straight from a link (?run=<id>). */
  initialRunId?: string | null
}>()

const emit = defineEmits<{
  (e: 'failed-count', count: number): void
  (e: 'open-run', id: string | null): void
  /** A run changed state, so anything counting runs is stale. */
  (e: 'retried'): void
}>()

const t = useT()
const { preference } = useLang()
const {
  runs,
  counts,
  nextBefore,
  loading,
  loadingMore,
  error,
  statusFilter,
  ruleFilter,
  selectedId,
  detail,
  detailLoading,
  retrying,
  retryError,
  load,
  loadMore,
  open,
  close,
  retry: retryRun,
} = useGrowthExecutions()

async function retry(id: string) {
  await retryRun(id)
  emit('retried')
}

onMounted(async () => {
  await load()
  if (props.initialRunId) open(props.initialRunId)
})

watch(() => counts.value.failed, (n) => emit('failed-count', n), { immediate: true })
watch(selectedId, (id) => emit('open-run', id))

const STATUS_TONE: Record<RunStatus, 'info' | 'success' | 'neutral' | 'danger'> = {
  running: 'info',
  done: 'success',
  cancelled: 'neutral',
  failed: 'danger',
}

function statusLabel(status: RunStatus) {
  if (status === 'running') return t('Running', 'En curso')
  if (status === 'done') return t('Finished', 'Terminada')
  if (status === 'cancelled') return t('Stopped', 'Detenida')
  return t('Failed', 'Fallida')
}

const filters = computed<{ key: RunStatus | null; label: string; count: number | null }[]>(() => [
  { key: null, label: t('All', 'Todas'), count: null },
  { key: 'failed', label: t('Failed', 'Fallidas'), count: counts.value.failed },
  { key: 'running', label: t('Running', 'En curso'), count: counts.value.running },
  { key: 'done', label: t('Finished', 'Terminadas'), count: counts.value.done },
  { key: 'cancelled', label: t('Stopped', 'Detenidas'), count: counts.value.cancelled },
])

function when(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(preference.value === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// What the list says under the lead, per status: where it is, why it
// stopped, or what went wrong -- so most questions are answered without
// opening the run at all.
function summary(row: (typeof runs.value)[number]) {
  if (row.status === 'failed') return row.lastError ?? t('A step failed.', 'Un paso ha fallado.')
  if (row.status === 'cancelled') return row.stoppedReason ?? t('Stopped', 'Detenida')
  if (row.status === 'done') return t('Every step ran', 'Se ejecutaron todos los pasos')
  if (row.lastError) return row.lastError
  if (row.resumeAt && new Date(row.resumeAt).getTime() > Date.now()) {
    return `${row.currentStep ?? t('Next step', 'Siguiente paso')} · ${when(row.resumeAt)}`
  }
  return row.currentStep ?? ''
}

const OUTCOME_TONE: Record<ExecutionEvent['outcome'], 'brand' | 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  started: 'neutral',
  sent: 'success',
  dry_run: 'warning',
  skipped: 'warning',
  failed: 'danger',
  waiting: 'info',
  deferred: 'warning',
  stopped: 'neutral',
  finished: 'success',
  retried: 'brand',
}

function outcomeLabel(outcome: ExecutionEvent['outcome']) {
  const labels: Record<ExecutionEvent['outcome'], [string, string]> = {
    started: ['Started', 'Iniciada'],
    sent: ['Sent', 'Enviado'],
    dry_run: ['Test run · not sent', 'Prueba · no enviado'],
    skipped: ['Skipped', 'Omitido'],
    failed: ['Failed', 'Falló'],
    waiting: ['Waiting', 'Esperando'],
    deferred: ['Deferred', 'Aplazada'],
    stopped: ['Stopped', 'Detenida'],
    finished: ['Finished', 'Terminada'],
    retried: ['Retried', 'Reintentada'],
  }
  const [en, es] = labels[outcome]
  return t(en, es)
}

function eventTitle(event: ExecutionEvent) {
  if (event.stepLabel) return event.stepLabel
  if (event.outcome === 'retried') return event.actor ? t(`Retried by ${event.actor}`, `Reintentada por ${event.actor}`) : t('Retried', 'Reintentada')
  if (event.outcome === 'started') return t('Automation started', 'Automatización iniciada')
  if (event.outcome === 'finished') return t('Automation finished', 'Automatización terminada')
  return ''
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start" data-test="executions">
    <section class="flex min-w-0 flex-col rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center gap-2 border-b border-line-divider px-4 py-3">
        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="f in filters"
            :key="f.key ?? 'all'"
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-[11.5px] font-medium"
            :class="statusFilter === f.key ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:bg-surface-subtle'"
            :data-test="`executions-filter-${f.key ?? 'all'}`"
            @click="statusFilter = f.key"
          >
            {{ f.label }}
            <span
              v-if="f.count !== null"
              class="rounded-pill px-1.5 text-[10.5px] font-semibold"
              :class="f.key === 'failed' && f.count > 0 ? 'bg-danger-bg text-danger-text' : 'bg-chip-bg text-chip-text'"
            >{{ f.count }}</span>
          </button>
        </div>
        <select
          v-model="ruleFilter"
          class="ml-auto h-7 rounded-ctl border border-line-control bg-surface px-2 text-[11.5px] text-ink-700"
          data-test="executions-workflow"
        >
          <option :value="null">{{ t('All workflows', 'Todos los flujos') }}</option>
          <option v-for="w in workflows" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <UiBtn size="sm" variant="ghost" :disabled="loading" data-test="executions-refresh" @click="load">
          {{ t('Refresh', 'Actualizar') }}
        </UiBtn>
      </div>

      <p v-if="error" class="px-4 py-6 text-[12px] text-danger-text">{{ error }}</p>

      <div v-else-if="loading && runs.length === 0" class="flex animate-pulse flex-col gap-2 p-4" aria-hidden="true">
        <div v-for="i in 5" :key="i" class="h-9 touch:h-11 rounded-ctl bg-surface-subtle" />
      </div>

      <p v-else-if="runs.length === 0" class="px-4 py-10 text-center text-[12px] text-ink-muted" data-test="executions-empty">
        {{
          statusFilter === 'failed'
            ? t('Nothing has failed. Every step either went out or was skipped for a reason.', 'No ha fallado nada. Cada paso se envió o se omitió por un motivo.')
            : t('No executions yet. A run appears here as soon as a lead enters an automation.', 'Aún no hay ejecuciones. Aparecerán en cuanto un lead entre en una automatización.')
        }}
      </p>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-[12px]">
          <thead>
            <tr class="border-b border-line-divider text-left text-[10.5px] uppercase tracking-[.06em] text-ink-faint">
              <th class="px-4 py-2 font-semibold">{{ t('Status', 'Estado') }}</th>
              <th class="px-2 py-2 font-semibold">{{ t('Lead', 'Lead') }}</th>
              <th class="hidden px-2 py-2 font-semibold md:table-cell">{{ t('Workflow', 'Flujo') }}</th>
              <th class="px-2 py-2 font-semibold">{{ t('Started', 'Inicio') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in runs"
              :key="row.id"
              class="cursor-pointer border-b border-line-divider last:border-0"
              :class="selectedId === row.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
              :data-test="`execution-${row.id}`"
              @click="open(row.id)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 align-top">
                <UiPill :tone="STATUS_TONE[row.status]" dot>{{ statusLabel(row.status) }}</UiPill>
              </td>
              <td class="min-w-0 px-2 py-2.5 align-top">
                <div class="font-medium text-ink-900">{{ row.leadName }}</div>
                <div class="mt-0.5 line-clamp-2 text-[11px] [overflow-wrap:anywhere]" :class="row.status === 'failed' ? 'text-danger-text' : 'text-ink-muted'">{{ summary(row) }}</div>
              </td>
              <td class="hidden px-2 py-2.5 align-top text-ink-700 md:table-cell">{{ row.ruleName }}</td>
              <td class="whitespace-nowrap px-2 py-2.5 align-top text-ink-muted">{{ when(row.startedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="nextBefore" class="flex justify-center border-t border-line-divider py-2">
          <UiBtn size="sm" :disabled="loadingMore" @click="loadMore">{{ t('Load more', 'Cargar más') }}</UiBtn>
        </div>
      </div>
    </section>

    <!-- One run's history. -->
    <section class="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" data-test="execution-detail">
      <p v-if="!selectedId" class="text-[11.5px] leading-[1.5] text-ink-muted">
        {{ t('Select an execution to see every step it ran, and why any of them did not go out.', 'Selecciona una ejecución para ver cada paso y por qué alguno no se envió.') }}
      </p>

      <div v-else-if="detailLoading && !detail" class="flex animate-pulse flex-col gap-2" aria-hidden="true">
        <div v-for="i in 4" :key="i" class="h-9 rounded-ctl bg-surface-subtle" />
      </div>

      <template v-else-if="detail">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ detail.run.ruleName }}</div>
            <NuxtLink :to="`/growth/leads?lead=${detail.run.leadId}`" class="text-[13px] font-semibold text-ink-900 hover:underline">{{ detail.run.leadName }}</NuxtLink>
            <div class="text-[11px] text-ink-muted">{{ detail.run.leadPhone ?? detail.run.leadEmail ?? '' }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UiPill :tone="STATUS_TONE[detail.run.status]" dot data-test="execution-status">{{ statusLabel(detail.run.status) }}</UiPill>
            <button type="button" class="px-1 text-[16px] leading-none text-ink-faint hover:text-ink-700" :aria-label="t('Close', 'Cerrar')" @click="close">×</button>
          </div>
        </div>

        <div v-if="detail.run.status === 'failed'" class="flex flex-col gap-2 rounded-ctl border border-danger-border bg-danger-bg p-3">
          <p class="text-[11.5px] leading-[1.5] text-danger-text [overflow-wrap:anywhere]">{{ detail.run.lastError }}</p>
          <p class="text-[11px] leading-[1.5] text-ink-muted">
            {{ t('Fix the cause (the template, the connection, the webhook), then retry. It resumes at the step that failed; nothing already sent goes out again.', 'Corrige la causa (la plantilla, la conexión, el webhook) y reintenta. Se reanuda en el paso que falló; nada de lo ya enviado se vuelve a enviar.') }}
          </p>
          <div class="flex items-center gap-2">
            <UiBtn variant="primary" size="sm" :disabled="retrying" data-test="execution-retry" @click="retry(detail.run.id)">
              {{ retrying ? t('Retrying…', 'Reintentando…') : t('Retry from this step', 'Reintentar desde este paso') }}
            </UiBtn>
          </div>
          <p v-if="retryError" class="text-[11px] text-danger-text">{{ retryError }}</p>
        </div>

        <p v-if="detail.run.dryRun" class="rounded-ctl border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[11px] text-warning-text">
          {{ t('This workflow is a test run: it records what it would send, and sends nothing.', 'Este flujo está en prueba: registra lo que enviaría y no envía nada.') }}
        </p>

        <ol class="flex flex-col" data-test="execution-events">
          <li v-for="event in detail.events" :key="event.id" class="relative flex gap-2.5 pb-3 last:pb-0" :data-test="`execution-event-${event.outcome}`">
            <span class="mt-[5px] h-2 w-2 shrink-0 rounded-full" :class="{
              'bg-success-accent': OUTCOME_TONE[event.outcome] === 'success',
              'bg-danger-text': OUTCOME_TONE[event.outcome] === 'danger',
              'bg-warning-accent': OUTCOME_TONE[event.outcome] === 'warning',
              'bg-info-accent': OUTCOME_TONE[event.outcome] === 'info',
              'bg-brand': OUTCOME_TONE[event.outcome] === 'brand',
              'bg-ink-faint3': OUTCOME_TONE[event.outcome] === 'neutral',
            }" />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="min-w-0 truncate text-[11.5px] font-medium text-ink-900">{{ eventTitle(event) || outcomeLabel(event.outcome) }}</span>
                <span class="shrink-0 text-[10.5px] text-ink-faint">{{ when(event.at) }}</span>
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <UiPill :tone="OUTCOME_TONE[event.outcome]">{{ outcomeLabel(event.outcome) }}</UiPill>
              </div>
              <p v-if="event.outcome === 'waiting' && event.detail?.startsWith('Until ')" class="mt-1 text-[11px] text-ink-muted">
                {{ t('Until', 'Hasta') }} {{ when(event.detail.slice(6)) }}
              </p>
              <p v-else-if="event.detail" class="mt-1 text-[11px] leading-[1.5] [overflow-wrap:anywhere]" :class="event.outcome === 'failed' ? 'text-danger-text' : 'text-ink-muted'">{{ event.detail }}</p>
            </div>
          </li>
        </ol>
      </template>

      <p v-else class="text-[11.5px] text-ink-muted">{{ t('This execution could not be loaded.', 'No se pudo cargar esta ejecución.') }}</p>
    </section>
  </div>
</template>
