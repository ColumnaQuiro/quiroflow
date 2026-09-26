<script setup lang="ts">
import { OUTCOMES, say } from '~/utils/automationCatalog'
import { serverMessage } from '~/utils/serverMessage'

// History: the latest things this automation did, newest first -- people
// entering, waiting, taking a path, and every message it sent or recorded.

const b = useBuilder()
const t = useT()
const { preference } = useLang()

interface Item {
  kind: 'event' | 'whatsapp' | 'email'
  id: string
  runId: string | null
  at: string
  outcome: string
  label: string | null
  detail: string | null
  person: string | null
  patientId: string | null
  leadId: string | null
}
const items = ref<Item[]>([])
const canReadWhatsApp = ref(true)
const loading = ref(true)
const error = ref('')

async function load() {
  if (!b.ruleId.value) return
  loading.value = true
  try {
    const res = await useStaffFetch<{ items: Item[]; canReadWhatsApp: boolean }>(`/api/automations/${b.ruleId.value}/history`)
    items.value = res.items
    canReadWhatsApp.value = res.canReadWhatsApp
  } catch (e) {
    error.value = serverMessage(e) ?? t('Could not load the history.', 'No se ha podido cargar el historial.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const when = (iso: string) => new Date(iso).toLocaleString(preference.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const TONE: Record<string, string> = {
  failed: 'bg-danger-text',
  bounced: 'bg-danger-text',
  dry_run: 'bg-warning-accent',
  would_send: 'bg-warning-accent',
  sent: 'bg-success-accent',
  delivered: 'bg-success-accent',
  read: 'bg-success-accent',
  opened: 'bg-success-accent',
  clicked: 'bg-success-accent',
  applied: 'bg-success-accent',
  finished: 'bg-success-accent',
  waiting: 'bg-info-accent',
}
const kindLabel = (i: Item) => (i.kind === 'whatsapp' ? 'WhatsApp' : i.kind === 'email' ? 'Email' : '')
defineExpose({ reload: load })
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" data-test="history">
    <div class="mx-auto flex max-w-[860px] flex-col gap-3">
      <p v-if="!canReadWhatsApp" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-muted">
        {{ t('WhatsApp messages need Inbox access -- ask an owner to turn it on for your role.', 'Los mensajes de WhatsApp necesitan acceso a la Bandeja -- pide a un propietario que lo active para tu rol.') }}
      </p>
      <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
      <div v-else-if="loading" class="flex animate-pulse flex-col gap-2" aria-hidden="true">
        <div v-for="i in 6" :key="i" class="h-12 rounded-ctl bg-surface" />
      </div>
      <p v-else-if="items.length === 0" class="rounded-card border border-line bg-surface px-4 py-10 text-center text-[13px] text-ink-muted" data-test="history-empty">
        {{ t('Nothing yet. What this automation does appears here as it happens.', 'Nada todavía. Lo que haga esta automatización aparecerá aquí.') }}
      </p>
      <ol v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <li v-for="i in items" :key="`${i.kind}-${i.id}`" class="flex items-start gap-3 border-b border-line-row px-4 py-2.5 last:border-0" :data-test="`history-${i.kind}`">
          <span class="mt-[7px] h-2 w-2 shrink-0 rounded-full" :class="TONE[i.outcome] ?? 'bg-ink-faint3'" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <strong class="text-[13px] text-ink-900">{{ i.person ?? '—' }}</strong>
              <span class="text-[12.5px] text-ink-700">
                <template v-if="kindLabel(i)">{{ kindLabel(i) }} · </template>{{ i.label ?? '' }}
              </span>
              <UiPill :tone="i.outcome === 'failed' || i.outcome === 'bounced' ? 'danger' : i.outcome === 'dry_run' || i.outcome === 'would_send' ? 'warning' : 'neutral'">{{ say(t, OUTCOMES[i.outcome] ?? [i.outcome, i.outcome]) }}</UiPill>
            </div>
            <p v-if="i.detail" class="mt-0.5 text-[12px] text-ink-muted [overflow-wrap:anywhere]">{{ i.detail }}</p>
          </div>
          <span class="shrink-0 text-[11.5px] text-ink-faint">{{ when(i.at) }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>
