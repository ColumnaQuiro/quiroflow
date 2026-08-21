<script setup lang="ts">
interface HoverAppointment {
  id: string
  patient_id: string
  starts_at: string
  note: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
}

const props = defineProps<{ appointment: HoverAppointment }>()
const emit = defineEmits<{ noteSaved: [] }>()

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

function formatMoney(cents: number) {
  return `€${(Math.abs(cents) / 100).toFixed(2)}`
}
</script>

<template>
  <div class="w-80 rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-xl">
    <p class="font-semibold text-gray-900">{{ appointment.patients?.first_name }} {{ appointment.patients?.last_name }}</p>
    <p class="text-gray-600">
      {{ appointment.appointment_types?.name ?? 'Visit' }} &middot;
      {{ new Date(appointment.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
      <span v-if="visitNumber">({{ visitNumber }}{{ visitNumber === 1 ? 'st' : visitNumber === 2 ? 'nd' : visitNumber === 3 ? 'rd' : 'th' }} visit)</span>
    </p>
    <p v-if="nextVisit" class="mt-1 text-xs text-gray-500">
      Next Visit: <span class="font-medium text-gray-700">{{ new Date(nextVisit).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
    </p>

    <div class="mt-3">
      <label class="block text-xs font-medium text-gray-500">Appt Note</label>
      <input v-model="apptNote" type="text" placeholder="Quick note for this visit…" class="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none" @blur="saveApptNote" />
    </div>

    <div class="mt-2">
      <label class="block text-xs font-medium text-gray-500">Sticky Note</label>
      <textarea v-model="stickyNote" rows="3" placeholder="Persistent clinical note for this patient…" class="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none" @blur="saveStickyNote"></textarea>
    </div>

    <div class="mt-3 border-t border-gray-100 pt-2">
      <p class="text-xs font-medium text-gray-500">Billing</p>
      <div v-if="!billingLoading" class="mt-0.5 space-y-0.5 text-xs">
        <p v-for="p in activePackages" :key="p.id" class="text-gray-700">{{ p.package_name }} ({{ p.sessions_used }}/{{ p.sessions_total }})</p>
        <p :class="balanceCents < 0 ? 'text-red-600' : balanceCents > 0 ? 'text-green-600' : 'text-gray-500'">
          {{ balanceCents === 0 ? 'No balance due' : balanceCents < 0 ? `${formatMoney(balanceCents)} owing` : `${formatMoney(balanceCents)} credit` }}
        </p>
      </div>
    </div>

    <div class="mt-3 border-t border-gray-100 pt-2">
      <p class="text-xs font-medium text-gray-500">Changelog</p>
      <div v-if="loading" class="mt-1 text-xs text-gray-400">Loading…</div>
      <ul v-else-if="changelog.length > 0" class="mt-1 max-h-28 space-y-1 overflow-y-auto text-xs text-gray-500">
        <li v-for="(entry, i) in changelog" :key="i">
          {{ entry.summary }} &middot; {{ entry.team_members?.full_name ?? 'System' }} on {{ new Date(entry.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
        </li>
      </ul>
      <p v-else class="mt-1 text-xs text-gray-400">No changes logged yet.</p>
    </div>
  </div>
</template>
