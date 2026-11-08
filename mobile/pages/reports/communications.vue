<script setup lang="ts">
// Comunicaciones, on the phone: the web's pages/reports/communications.vue --
// the same communications_log query, filters and search, so a filter here
// returns what it returns there. communications_log's parts each keep their
// own table's policy (WhatsApp needs inbox access; email and push follow the
// viewer's patient scope), so nobody sees a message here they could not see
// where it lives. Reshaped for a phone: channel, type and status are chips,
// the search is a field above the list, the seven-column table is a list
// (who, and the status; type, channel, recipient, date and the message
// preview underneath), and the web's Previous/Next pages of fifty become
// "Ver más", which fetches the next fifty onto the end.
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'

definePageMeta({ layout: 'practitioner' })

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

const PATH = '/reports/communications'
const PAGE = 50
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()

const range = ref(computePresetRange({ months: 1 }))
const search = ref('')
const channel = ref('')
const kind = ref('')
const status = ref('')
const page = ref(0)
const rows = ref<LogRow[]>([])
const total = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref(false)

// `more` fetches the next page onto the end; anything else starts again from
// the first. A filter changed while a load is in flight starts another run;
// only the latest may write.
let run = 0
async function load(more = false) {
  const mine = ++run
  if (more) loadingMore.value = true
  else {
    loading.value = true
    page.value = 0
  }
  loadError.value = false
  const nextPage = more ? page.value + 1 : 0
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
  const { data, count, error } = await q.order('sent_at', { ascending: false }).range(nextPage * PAGE, nextPage * PAGE + PAGE - 1)
  if (mine !== run) return
  loading.value = false
  loadingMore.value = false
  if (error) {
    loadError.value = true
    return
  }
  const got = (data as LogRow[] | null) ?? []
  rows.value = more ? [...rows.value, ...got] : got
  page.value = nextPage
  total.value = count ?? 0
}
// Only once the role is known to include it.
const allowed = computed(() => !!context.value && canOpen(PATH))
watch(allowed, (ok) => { if (ok) load() }, { immediate: true })
watch([range, channel, kind, status], () => { if (allowed.value) load() })
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { if (allowed.value) load() }, 300)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const CHANNELS = computed(() => [
  { id: 'whatsapp', name: 'WhatsApp' },
  { id: 'instagram', name: 'Instagram' },
  { id: 'messenger', name: 'Messenger' },
  { id: 'webchat', name: t('Website chat', 'Chat de la web') },
  { id: 'email', name: t('Email', 'Correo') },
  { id: 'app', name: t('App message', 'Mensaje en la app') },
  { id: 'push', name: t('Push notification', 'Notificación push') },
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
const kindOptions = computed(() => Object.entries(KINDS.value).map(([id, name]) => ({ id, name })))
const statusOptions = computed(() => Object.entries(STATUSES.value).map(([id, s]) => ({ id, name: s.label })))
const channelLabel = (c: string) => CHANNELS.value.find((x) => x.id === c)?.name ?? c
const kindLabel = (k: string) => KINDS.value[k] ?? k
const statusOf = (s: string | null) => (s && STATUSES.value[s]) || { label: s ?? '–', tone: 'neutral' as const }
const recipientOf = (r: LogRow) => (r.kind === 'broadcast' && r.recipient ? t(`${r.recipient} patients`, `${r.recipient} pacientes`) : r.recipient ?? '–')
const when = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
function who(r: LogRow) {
  if (r.patient_id) return shown(r.contact_name ?? t('Patient', 'Paciente'))
  if (r.contact_name) return `${shown(r.contact_name)} · lead`
  return r.kind === 'broadcast' ? t('Everyone with the app', 'Todos con la app') : '–'
}
function detail(r: LogRow) {
  return [kindLabel(r.kind), channelLabel(r.channel), recipientOf(r), when(r.sent_at)].join(' · ')
}
</script>

<template>
  <ReportScreen :title="t('Communications', 'Comunicaciones')" path="/reports/communications" :description="t('Every message sent to patients and leads', 'Todos los mensajes enviados a pacientes y leads')">
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportSelect v-model="channel" :options="CHANNELS" :all-label="t('All channels', 'Todos los canales')" :label="t('Channel', 'Canal')" data-cy="report-communications-channel" />
      <ReportSelect v-model="kind" :options="kindOptions" :all-label="t('All types', 'Todos los tipos')" :label="t('Type', 'Tipo')" data-cy="report-communications-kind" />
      <ReportSelect v-model="status" :options="statusOptions" :all-label="t('Any status', 'Cualquier estado')" :label="t('Status', 'Estado')" data-cy="report-communications-status" />
    </template>

    <input
      v-model="search"
      type="search"
      :placeholder="t('Search by name, recipient or message', 'Buscar por nombre, destinatario o mensaje')"
      :aria-label="t('Search', 'Buscar')"
      class="h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 placeholder:text-ink-faint focus:border-brand focus:outline-none"
      data-cy="report-communications-search"
    />

    <ReportsModule :title="t('Messages', 'Mensajes')" :loading="loading" skeleton="list" :rows="8">
      <p v-if="!loadError" class="text-[12.5px] text-ink-muted" data-cy="report-communications-count">
        {{ t(`Showing ${rows.length} of ${total}`, `Mostrando ${rows.length} de ${total}`) }}
      </p>
      <p v-if="loadError && rows.length === 0" class="mt-2 rounded-ctl bg-danger-bg px-3 py-2.5 text-[13.5px] text-danger-text" role="alert">
        {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-1 font-semibold underline" @click="load()">{{ t('Try again', 'Reintentar') }}</button>
      </p>
      <p v-else-if="rows.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No messages match.', 'Ningún mensaje coincide.') }}</p>
      <template v-else>
        <ul class="mt-1" data-cy="report-communications-list">
          <ReportRow v-for="r in rows" :key="`${r.channel}-${r.id}`" :to="r.patient_id ? `/patients/${r.patient_id}` : undefined" :title="who(r)" :subtitle="detail(r)" data-cy="report-communications-row">
            <span v-if="r.preview" class="line-clamp-2 text-[12.5px] leading-snug text-ink-700">{{ r.preview }}</span>
            <template #trailing>
              <UiPill :tone="statusOf(r.status).tone" class="shrink-0">{{ statusOf(r.status).label }}</UiPill>
            </template>
          </ReportRow>
        </ul>
        <p v-if="loadError" class="mt-2 rounded-ctl bg-danger-bg px-3 py-2.5 text-[13.5px] text-danger-text" role="alert">
          {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
          <button type="button" class="ml-1 font-semibold underline" @click="load(true)">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <AppButton v-else-if="rows.length < total" class="mt-2 w-full" :disabled="loadingMore" data-cy="report-communications-more" @click="load(true)">
          {{ loadingMore ? t('Loading…', 'Cargando…') : t(`Show more (${total - rows.length})`, `Ver más (${total - rows.length})`) }}
        </AppButton>
      </template>
    </ReportsModule>
  </ReportScreen>
</template>
