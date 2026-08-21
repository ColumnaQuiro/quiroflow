<script setup lang="ts">
interface HoverAppointment {
  id: string
  patient_id: string
  room_id: string | null
  practitioner_id: string | null
  starts_at: string
  ends_at: string
  status: string
  confirmation_status: string | null
  checked_in_at: string | null
  note: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const props = defineProps<{ appointment: HoverAppointment; roomName?: string | null }>()
const emit = defineEmits<{ noteSaved: []; checkIn: [] }>()

const supabase = useSupabaseClient()
const { loading: billingLoading, balanceCents, activePackages } = usePatientFinancialSummary(() => props.appointment.patient_id)

const visitNumber = ref<number | null>(null)
const nextVisit = ref<string | null>(null)
const stickyNote = ref('')
const apptNote = ref(props.appointment.note ?? '')

interface ChangelogEntry {
  summary: string
  created_at: string
  team_members: { full_name: string } | null
}
const changelog = ref<ChangelogEntry[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  apptNote.value = props.appointment.note ?? ''

  const [{ count }, { data: next }, { data: patient }, { data: logs }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', props.appointment.patient_id)
      .neq('status', 'cancelled')
      .lte('starts_at', props.appointment.starts_at),
    supabase
      .from('appointments')
      .select('starts_at')
      .eq('patient_id', props.appointment.patient_id)
      .eq('status', 'booked')
      .gt('starts_at', props.appointment.starts_at)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from('patients').select('sticky_note').eq('id', props.appointment.patient_id).maybeSingle(),
    supabase
      .from('audit_logs')
      .select('summary, created_at, team_members(full_name)')
      .eq('entity_type', 'appointment')
      .eq('entity_id', props.appointment.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  visitNumber.value = count ?? null
  nextVisit.value = next?.starts_at ?? null
  stickyNote.value = patient?.sticky_note ?? ''
  changelog.value = (logs as unknown as ChangelogEntry[]) ?? []
  loading.value = false
}

watch(() => props.appointment.id, load, { immediate: true })

async function saveApptNote() {
  await supabase.from('appointments').update({ note: apptNote.value || null }).eq('id', props.appointment.id)
  emit('noteSaved')
}
async function saveStickyNote() {
  await supabase.from('patients').update({ sticky_note: stickyNote.value || null }).eq('id', props.appointment.patient_id)
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function hm(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const timeRange = computed(() => `${hm(props.appointment.starts_at)}–${hm(props.appointment.ends_at)}`)

const initials = computed(() => {
  const p = props.appointment.patients
  return `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase() || '?'
})
const patientName = computed(() => `${props.appointment.patients?.first_name ?? ''} ${props.appointment.patients?.last_name ?? ''}`.trim())
const practitionerName = computed(() => props.appointment.team_members?.full_name ?? 'Unassigned')

// The block palette collapses onto four visual states; a pending or
// reschedule-requested confirmation on an otherwise-booked appointment both
// read as "Unconfirmed" (amber) since the app has no separate 4th status.
const visualStatus = computed<'booked' | 'completed' | 'unconfirmed' | 'no_show' | 'cancelled'>(() => {
  const a = props.appointment
  if (a.status === 'completed') return 'completed'
  if (a.status === 'no_show') return 'no_show'
  if (a.status === 'cancelled') return 'cancelled'
  if (a.status === 'booked' && (a.confirmation_status === 'pending' || a.confirmation_status === 'reschedule_requested')) return 'unconfirmed'
  return 'booked'
})
const PILL_TONE: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  booked: 'brand',
  completed: 'success',
  unconfirmed: 'warning',
  no_show: 'danger',
  cancelled: 'neutral',
}
const statusLabel = computed(() => {
  if (visualStatus.value === 'unconfirmed' && props.appointment.confirmation_status === 'reschedule_requested') return 'Wants to reschedule'
  return { booked: 'Booked', completed: 'Completed', unconfirmed: 'Unconfirmed', no_show: 'No-show', cancelled: 'Cancelled' }[visualStatus.value]
})

function formatMoney(cents: number) {
  return `€${(Math.abs(cents) / 100).toFixed(2)}`
}
const balanceLabel = computed(() => (balanceCents.value === 0 ? 'No balance due' : balanceCents.value < 0 ? `${formatMoney(balanceCents.value)} owing` : `${formatMoney(balanceCents.value)} credit`))

function visitOrdinal(n: number) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
</script>

<template>
  <div class="hovercard-pop w-[300px] rounded-card border border-line bg-surface p-4 shadow-popover">
    <div class="flex items-start gap-2.5">
      <div class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-white">{{ initials }}</div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[13.5px] font-[620] text-ink-900">{{ patientName }}</p>
        <p class="truncate text-[11.5px] text-ink-muted2">{{ practitionerName }} &middot; {{ roomName ?? 'No room' }}</p>
      </div>
      <UiPill :tone="PILL_TONE[visualStatus]" dot class="shrink-0">{{ statusLabel }}</UiPill>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-y-1.5 border-t border-line-divider pt-3 text-[12.5px]">
      <span class="text-ink-muted2">Time</span>
      <span class="text-right font-mono text-[12px] text-ink-700">{{ timeRange }}</span>
      <span class="text-ink-muted2">Type</span>
      <span class="truncate text-right text-ink-700">{{ appointment.appointment_types?.name ?? '—' }}</span>
      <span class="text-ink-muted2">Practitioner</span>
      <span class="truncate text-right text-ink-700">{{ practitionerName }}</span>
      <span class="text-ink-muted2">Balance</span>
      <span class="text-right font-medium" :class="balanceCents < 0 ? 'text-danger-text' : balanceCents > 0 ? 'text-success-text' : 'text-ink-muted2'">
        {{ balanceLabel }}
      </span>
    </div>
    <p v-if="visitNumber" class="mt-1.5 text-[11px] text-ink-faint">
      {{ visitOrdinal(visitNumber) }} visit
      <span v-if="nextVisit">&middot; Next: {{ new Date(nextVisit).toLocaleDateString([], { day: 'numeric', month: 'short' }) }}</span>
    </p>
    <p v-if="!billingLoading && activePackages.length > 0" class="mt-1 truncate text-[11px] text-ink-faint">
      {{ activePackages[0].package_name }} ({{ activePackages[0].sessions_used }}/{{ activePackages[0].sessions_total }})
    </p>

    <div class="mt-3 border-t border-line-divider pt-3">
      <label class="block text-[11px] font-medium text-ink-muted2">Note</label>
      <input
        v-model="apptNote"
        type="text"
        placeholder="Quick note for this visit…"
        class="mt-1 w-full rounded-ctlSm border border-line-control bg-surface px-2 py-1 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
        @blur="saveApptNote"
      />
    </div>

    <div class="mt-2">
      <label class="block text-[11px] font-medium text-ink-muted2">Patient note</label>
      <textarea
        v-model="stickyNote"
        rows="2"
        placeholder="Persistent clinical note for this patient…"
        class="mt-1 w-full resize-none rounded-ctlSm border border-line-control bg-surface px-2 py-1 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
        @blur="saveStickyNote"
      ></textarea>
    </div>

    <div v-if="!loading && changelog.length > 0" class="mt-3 border-t border-line-divider pt-2">
      <p class="text-[11px] font-medium text-ink-muted2">Recent activity</p>
      <ul class="mt-1 max-h-16 space-y-0.5 overflow-y-auto text-[11px] text-ink-faint">
        <li v-for="(entry, i) in changelog" :key="i" class="truncate">
          {{ entry.summary }} &middot; {{ entry.team_members?.full_name ?? 'System' }}
        </li>
      </ul>
    </div>

    <div class="mt-3 flex gap-2">
      <UiBtn variant="primary" size="sm" class="flex-1 justify-center" @click="emit('checkIn')">
        {{ appointment.checked_in_at ? 'Checked in' : 'Check in' }}
      </UiBtn>
      <NuxtLink :to="`/patients/${appointment.patient_id}`" target="_blank" class="flex-1">
        <UiBtn variant="secondary" size="sm" class="w-full justify-center">Open chart</UiBtn>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.hovercard-pop {
  animation: hovercard-in 120ms ease-out;
}
@keyframes hovercard-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
