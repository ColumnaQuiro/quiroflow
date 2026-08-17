<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Recall = Tables<'recall_candidates'>
type TeamMember = Pick<Tables<'team_members'>, 'id' | 'full_name'>
type ContactLogRow = Pick<Tables<'contact_log'>, 'patient_id' | 'action' | 'created_at'>

const supabase = useSupabaseClient()
const store = useAccountStore()

const recalls = ref<Recall[]>([])
const teamMembers = ref<TeamMember[]>([])
const lastActionByPatient = ref<Record<string, ContactLogRow>>({})
const loading = ref(true)

const search = ref('')
const practitionerFilter = ref('')
const tagFilter = ref('')
const balanceFilter = ref<'any' | 'credit' | 'debit'>('any')
const priorityOnly = ref(false)
const minWeeksOverdue = ref('2')

async function load() {
  loading.value = true
  const [{ data: recallData }, { data: members }] = await Promise.all([
    supabase.from('recall_candidates').select('*'),
    supabase.from('team_members').select('id, full_name').order('full_name'),
  ])
  recalls.value = recallData ?? []
  teamMembers.value = members ?? []
  loading.value = false
}
onMounted(load)

const filtered = computed(() => {
  const minDays = (parseInt(minWeeksOverdue.value, 10) || 0) * 7
  return recalls.value
    .filter((r) => {
      if (search.value) {
        const name = `${r.first_name} ${r.last_name ?? ''}`.toLowerCase()
        if (!name.includes(search.value.toLowerCase())) return false
      }
      if (practitionerFilter.value && r.default_practitioner_id !== practitionerFilter.value) return false
      if (tagFilter.value && !(r.tags ?? []).some((t) => t.toLowerCase().includes(tagFilter.value.toLowerCase()))) return false
      if (balanceFilter.value === 'credit' && (r.balance_cents ?? 0) <= 0) return false
      if (balanceFilter.value === 'debit' && (r.balance_cents ?? 0) >= 0) return false
      if (priorityOnly.value && !r.recall_priority) return false
      if ((r.days_since_last_appointment ?? 0) < minDays) return false
      return true
    })
    .sort((a, b) => {
      if (!!a.recall_priority !== !!b.recall_priority) return a.recall_priority ? -1 : 1
      return (b.days_since_last_appointment ?? 0) - (a.days_since_last_appointment ?? 0)
    })
})

watch(
  filtered,
  async (rows) => {
    const ids = rows.slice(0, 200).map((r) => r.patient_id!)
    if (ids.length === 0) return
    const { data } = await supabase
      .from('contact_log')
      .select('patient_id, action, created_at')
      .in('patient_id', ids)
      .order('created_at', { ascending: false })
    const map: Record<string, ContactLogRow> = {}
    for (const row of data ?? []) {
      if (!map[row.patient_id]) map[row.patient_id] = row
    }
    lastActionByPatient.value = map
  },
  { immediate: true },
)

function practitionerName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? 'Unassigned'
}

function formatBalance(cents: number | null) {
  const c = cents ?? 0
  const amount = (Math.abs(c) / 100).toFixed(2)
  if (c > 0) return { text: `€${amount} CR`, class: 'text-green-600' }
  if (c < 0) return { text: `€${amount} DR`, class: 'text-red-600' }
  return { text: '€0.00', class: 'text-gray-400' }
}

const actionLabels: Record<string, string> = {
  sent_whatsapp: 'Sent WhatsApp',
  called_no_answer: 'Called – no answer',
  called_left_message: 'Called – left message',
  booked: 'Booked',
  other: 'Other',
}

async function refreshLastAction(patientId: string) {
  const { data } = await supabase
    .from('contact_log')
    .select('patient_id, action, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data) lastActionByPatient.value = { ...lastActionByPatient.value, [patientId]: data }
}

async function logAction(patientId: string, action: string) {
  await supabase.from('contact_log').insert({
    account_id: store.accountId!,
    patient_id: patientId,
    action,
  })
  await refreshLastAction(patientId)
}

async function togglePriority(recall: Recall) {
  const next = !recall.recall_priority
  await supabase.from('patients').update({ recall_priority: next }).eq('id', recall.patient_id!)
  recall.recall_priority = next
}

async function dismiss(recall: Recall) {
  if (!confirm(`Remove ${recall.first_name} from recalls?`)) return
  await supabase.from('patients').update({ recall_status: 'dismissed' }).eq('id', recall.patient_id!)
  recalls.value = recalls.value.filter((r) => r.patient_id !== recall.patient_id)
}

// --- Send WhatsApp modal ---
const sendingTo = ref<Recall | null>(null)

function openWhatsApp(recall: Recall) {
  sendingTo.value = recall
}
function onSent() {
  if (sendingTo.value) refreshLastAction(sendingTo.value.patient_id!)
  sendingTo.value = null
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Recalls</h1>
      <span class="text-sm text-gray-500">{{ filtered.length }} patient{{ filtered.length === 1 ? '' : 's' }}</span>
    </div>
    <p class="mt-1 text-sm text-gray-500">Patients with no future appointment booked.</p>

    <div class="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <input
        v-model="search"
        type="search"
        placeholder="Search by name"
        class="w-48 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select v-model="practitionerFilter" class="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
        <option value="">Any practitioner</option>
        <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
      </select>
      <input
        v-model="tagFilter"
        type="text"
        placeholder="Tag contains…"
        class="w-36 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select v-model="balanceFilter" class="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
        <option value="any">Any balance</option>
        <option value="credit">In credit</option>
        <option value="debit">In debt</option>
      </select>
      <select v-model="minWeeksOverdue" class="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
        <option value="0">Any recency</option>
        <option value="2">2+ weeks overdue</option>
        <option value="4">4+ weeks overdue</option>
        <option value="6">6+ weeks overdue</option>
        <option value="8">8+ weeks overdue</option>
        <option value="12">12+ weeks overdue</option>
      </select>
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        <input v-model="priorityOnly" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        High priority only
      </label>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Patient</th>
            <th class="px-4 py-2">Last Appointment</th>
            <th class="px-4 py-2">Practitioner</th>
            <th class="px-4 py-2">Tags</th>
            <th class="px-4 py-2">Balance</th>
            <th class="px-4 py-2">Last Action</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="7" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="7" class="px-4 py-6 text-center text-gray-400">No recalls match these filters.</td>
          </tr>
          <tr v-for="r in filtered" :key="r.patient_id!" class="align-top">
            <td class="px-4 py-2.5">
              <NuxtLink :to="`/patients/${r.patient_id}`" class="font-medium text-gray-900 hover:text-indigo-600">
                {{ r.first_name }} {{ r.last_name }}
              </NuxtLink>
              <span v-if="r.recall_priority" class="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">High priority</span>
            </td>
            <td class="px-4 py-2.5 text-gray-500">
              {{ r.last_appointment_at ? new Date(r.last_appointment_at).toLocaleDateString() : 'N/A' }}
              <span class="block text-xs text-gray-400">{{ r.days_since_last_appointment }} days ago</span>
            </td>
            <td class="px-4 py-2.5 text-gray-500">{{ practitionerName(r.default_practitioner_id) }}</td>
            <td class="px-4 py-2.5">
              <span v-for="tag in r.tags" :key="tag" class="mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{{ tag }}</span>
            </td>
            <td class="px-4 py-2.5" :class="formatBalance(r.balance_cents).class">{{ formatBalance(r.balance_cents).text }}</td>
            <td class="px-4 py-2.5 text-gray-500">
              <template v-if="lastActionByPatient[r.patient_id!]">
                {{ actionLabels[lastActionByPatient[r.patient_id!].action] ?? lastActionByPatient[r.patient_id!].action }}
                <span class="block text-xs text-gray-400">{{ new Date(lastActionByPatient[r.patient_id!].created_at).toLocaleDateString() }}</span>
              </template>
              <span v-else class="text-gray-300">&mdash;</span>
            </td>
            <td class="px-4 py-2.5 text-right">
              <div class="flex items-center justify-end gap-2">
                <button type="button" class="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700" @click="openWhatsApp(r)">
                  WhatsApp
                </button>
                <div class="relative">
                  <select
                    class="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600"
                    @change="
                      (e) => {
                        const v = (e.target as HTMLSelectElement).value
                        if (v === 'priority') togglePriority(r)
                        else if (v === 'dismiss') dismiss(r)
                        else if (v) logAction(r.patient_id!, v)
                        ;(e.target as HTMLSelectElement).value = ''
                      }
                    "
                  >
                    <option value="">Action…</option>
                    <option value="called_no_answer">Called – no answer</option>
                    <option value="called_left_message">Called – left message</option>
                    <option value="booked">Booked</option>
                    <option value="priority">{{ r.recall_priority ? 'Unmark priority' : 'Mark as high priority' }}</option>
                    <option value="dismiss">Dismiss from recalls</option>
                  </select>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SendWhatsAppModal
      v-if="sendingTo"
      :patient-id="sendingTo.patient_id!"
      :patient-first-name="sendingTo.first_name ?? ''"
      @close="sendingTo = null"
      @sent="onSent"
    />
  </div>
</template>
