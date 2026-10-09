<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'

// Communications: every message the clinic sent to a patient or a lead, on
// every channel, newest first -- WhatsApp and Instagram, email, app messages
// and push. Read from the communications_log view, whose parts each keep
// their own table's policy (WhatsApp needs inbox access; email and push follow
// the viewer's patient scope), so nobody sees a message here they could not
// see where it lives. A page at a time, with the total, since a clinic sends
// thousands a month.
interface LogRow {
  id: string
  patient_id: string | null
  lead_id: string | null
  channel: string
  kind: string
  status: string | null
  recipient: string | null
  preview: string | null
  sent_at: string
  contact_name: string | null
}

const PAGE = 50
const supabase = useSupabaseClient()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
const search = ref('')
const channel = ref('')
const kind = ref('')
const status = ref('')
const page = ref(0)
const rows = ref<LogRow[]>([])
const total = ref(0)
const loading = ref(true)
const loadError = ref(false)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  loadError.value = false
  const { from, to } = rangeBounds(range.value)
  let q = supabase
    .from('communications_log')
    .select('id, patient_id, lead_id, channel, kind, status, recipient, preview, sent_at, contact_name', { count: 'exact' })
    .gte('sent_at', from.toISOString())
    .lte('sent_at', to.toISOString())
  if (channel.value) q = q.eq('channel', channel.value)
  if (kind.value) q = q.eq('kind', kind.value)
  if (status.value) q = q.eq('status', status.value)
  // PostgREST's or() is comma- and bracket-delimited: those characters are
  // taken out of what was typed rather than escaped.
  const term = search.value.trim().replace(/[,()%*\\]/g, ' ').trim()
  if (term) q = q.or(`contact_name.ilike.%${term}%,recipient.ilike.%${term}%,preview.ilike.%${term}%`)
  const { data, count, error } = await q.order('sent_at', { ascending: false }).range(page.value * PAGE, page.value * PAGE + PAGE - 1)
  if (mine !== run) return
  loading.value = false
  if (error) {
    loadError.value = true
    return
  }
  rows.value = (data as LogRow[] | null) ?? []
  total.value = count ?? 0
}
onMounted(load)
watch([range, channel, kind, status], () => {
  page.value = 0
  load()
})
watch(page, load)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 0
    load()
  }, 300)
})

const CHANNELS = computed(() => [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'email', label: t('Email', 'Correo') },
  { value: 'app', label: t('App message', 'Mensaje en la app') },
  { value: 'push', label: t('Push notification', 'Notificación push') },
])
const KINDS = computed<Record<string, string>>(() => ({
  confirmation: t('Confirmation', 'Confirmación'),
  reminder: t('Reminder', 'Recordatorio'),
  recall: t('Recall', 'Recuperación'),
  automation: t('Automation', 'Automatización'),
  broadcast: t('Announcement', 'Aviso'),
  message: t('Message', 'Mensaje'),
  exercises: t('Exercises', 'Ejercicios'),
  appointment: t('Appointment', 'Cita'),
  other: t('General', 'General'),
}))
const STATUSES = computed<Record<string, { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' | 'warning' }>>(() => ({
  read: { label: t('Read', 'Leído'), tone: 'success' },
  delivered: { label: t('Delivered', 'Entregado'), tone: 'info' },
  sent: { label: t('Sent', 'Enviado'), tone: 'neutral' },
  failed: { label: t('Failed', 'Fallido'), tone: 'danger' },
  bounced: { label: t('Bounced', 'Rebotado'), tone: 'danger' },
  complained: { label: t('Marked as spam', 'Marcado como spam'), tone: 'warning' },
  not_delivered: { label: t('No device', 'Sin dispositivo'), tone: 'warning' },
}))
const channelLabel = (c: string) => CHANNELS.value.find((x) => x.value === c)?.label ?? c
const kindLabel = (k: string) => KINDS.value[k] ?? k
const statusOf = (s: string | null) => (s && STATUSES.value[s]) || { label: s ?? '–', tone: 'neutral' as const }
const recipientOf = (r: LogRow) => (r.kind === 'broadcast' && r.recipient ? t(`${r.recipient} patients`, `${r.recipient} pacientes`) : r.recipient ?? '–')
const when = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const shownFrom = computed(() => (total.value ? page.value * PAGE + 1 : 0))
const shownTo = computed(() => Math.min(total.value, page.value * PAGE + rows.value.length))

const select = 'h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Communications', 'Comunicaciones')" :meta="t('Every message sent to patients and leads', 'Todos los mensajes enviados a pacientes y leads')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="communications-log" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="search" type="search" :placeholder="t('Search by name, recipient or message', 'Buscar por nombre, destinatario o mensaje')" :class="[select, 'w-full sm:w-72']" data-cy="comms-search" />
        <ReportsDateRangeSelect v-model="range" />
        <select v-model="channel" :class="select" :aria-label="t('Channel', 'Canal')" data-cy="comms-channel">
          <option value="">{{ t('All channels', 'Todos los canales') }}</option>
          <option v-for="c in CHANNELS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
        <select v-model="kind" :class="select" :aria-label="t('Type', 'Tipo')" data-cy="comms-kind">
          <option value="">{{ t('All types', 'Todos los tipos') }}</option>
          <option v-for="(label, k) in KINDS" :key="k" :value="k">{{ label }}</option>
        </select>
        <select v-model="status" :class="select" :aria-label="t('Status', 'Estado')" data-cy="comms-status">
          <option value="">{{ t('Any status', 'Cualquier estado') }}</option>
          <option v-for="(s, k) in STATUSES" :key="k" :value="k">{{ s.label }}</option>
        </select>
      </div>

      <section class="mt-4 rounded-card border border-line bg-surface shadow-card">
        <div class="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3.5">
          <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Messages', 'Mensajes') }}</h2>
          <p class="text-[12.5px] text-ink-muted" data-cy="comms-count">
            {{ loading ? '' : t(`Showing ${shownFrom}–${shownTo} of ${total}`, `Mostrando ${shownFrom}–${shownTo} de ${total}`) }}
          </p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[860px] text-[13px]">
            <thead class="border-y border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-4 py-2">{{ t('Patient / lead', 'Paciente / lead') }}</th>
                <th class="px-3 py-2">{{ t('Type', 'Tipo') }}</th>
                <th class="px-3 py-2">{{ t('Channel', 'Canal') }}</th>
                <th class="px-3 py-2">{{ t('Recipient', 'Destinatario') }}</th>
                <th class="px-3 py-2">{{ t('Message', 'Mensaje') }}</th>
                <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
                <th class="px-4 py-2">{{ t('Date', 'Fecha') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <ReportsTableSkeletonRows v-if="loading" :cols="7" :rows="8" />
              <tr v-else-if="loadError">
                <td colspan="7" class="px-4 py-6 text-center text-danger-text">
                  {{ t("Couldn't load the messages.", 'No se han podido cargar los mensajes.') }}
                  <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
                </td>
              </tr>
              <tr v-else-if="!rows.length">
                <td colspan="7" class="px-4 py-6 text-center text-ink-faint">{{ t('No messages match.', 'Ningún mensaje coincide.') }}</td>
              </tr>
              <tr v-for="r in loading ? [] : rows" :key="`${r.channel}-${r.id}`" data-cy="comms-row">
                <td class="max-w-[180px] px-4 py-2 [&>*]:block [&>*]:truncate">
                  <NuxtLink v-if="r.patient_id" :to="`/patients/${r.patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">{{ r.contact_name ?? t('Patient', 'Paciente') }}</NuxtLink>
                  <span v-else-if="r.contact_name" class="text-ink-900">{{ r.contact_name }} <span class="text-[11px] text-ink-faint">· lead</span></span>
                  <span v-else class="text-ink-faint">{{ r.kind === 'broadcast' ? t('Everyone with the app', 'Todos con la app') : '–' }}</span>
                </td>
                <td class="px-3 py-2 text-ink-700">{{ kindLabel(r.kind) }}</td>
                <td class="px-3 py-2 text-ink-700">{{ channelLabel(r.channel) }}</td>
                <td class="px-3 py-2 text-ink-muted"><span class="block max-w-[170px] truncate">{{ recipientOf(r) }}</span></td>
                <td class="px-3 py-2 text-ink-muted" :title="r.preview ?? ''"><span class="block max-w-[300px] truncate">{{ r.preview ?? '–' }}</span></td>
                <td class="px-3 py-2"><UiPill :tone="statusOf(r.status).tone">{{ statusOf(r.status).label }}</UiPill></td>
                <td class="whitespace-nowrap px-4 py-2 text-ink-muted">{{ when(r.sent_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="total > PAGE" class="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <UiBtn :disabled="page === 0 || loading" data-cy="comms-prev" @click="page--">{{ t('Previous', 'Anterior') }}</UiBtn>
          <UiBtn :disabled="shownTo >= total || loading" data-cy="comms-next" @click="page++">{{ t('Next', 'Siguiente') }}</UiBtn>
        </div>
      </section>
    </div>
  </div>
</template>
