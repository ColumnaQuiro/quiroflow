<script setup lang="ts">
interface Rule {
  id: string
  name: string
  trigger_event: string
  enabled: boolean
}
interface Action {
  rule_id: string
  action_type: string
}
interface PatientOption { id: string; first_name: string; last_name: string | null }

const TRIGGER_LABELS: Record<string, string> = {
  'appointment.checked_in': 'Patient checked in',
  'appointment.booked': 'Appointment booked',
  'appointment.completed': 'Appointment completed',
  'appointment.cancelled': 'Appointment cancelled',
  'appointment.no_show': 'Appointment marked as missed',
  'invoice.paid': 'Invoice paid',
}
const ACTION_LABELS: Record<string, string> = {
  whatsapp_template: 'WhatsApp',
  email: 'Email',
  webhook: 'Webhook',
}

const supabase = useSupabaseClient()

const rules = ref<Rule[]>([])
const actionsByRule = ref<Record<string, Action[]>>({})
const loading = ref(true)
const modalOpen = ref(false)
const editingRuleId = ref<string | null>(null)

const sendNowForId = ref<string | null>(null)
const patientQuery = ref('')
const patients = ref<PatientOption[]>([])
const sending = ref(false)
const sentMessage = ref('')

async function load() {
  loading.value = true
  const { data: ruleRows } = await supabase.from('automation_rules').select('id, name, trigger_event, enabled').order('created_at', { ascending: false })
  rules.value = ruleRows ?? []

  const ids = rules.value.map((r) => r.id)
  if (ids.length > 0) {
    const { data: actionRows } = await supabase.from('automation_actions').select('rule_id, action_type').in('rule_id', ids).order('position')
    const grouped: Record<string, Action[]> = {}
    for (const a of actionRows ?? []) {
      ;(grouped[a.rule_id] ??= []).push(a)
    }
    actionsByRule.value = grouped
  } else {
    actionsByRule.value = {}
  }
  loading.value = false
}
onMounted(load)

function openCreate() {
  editingRuleId.value = null
  modalOpen.value = true
}
function openEdit(rule: Rule) {
  editingRuleId.value = rule.id
  modalOpen.value = true
}
async function onSaved() {
  modalOpen.value = false
  await load()
}

async function toggleEnabled(rule: Rule) {
  await supabase.from('automation_rules').update({ enabled: !rule.enabled }).eq('id', rule.id)
  await load()
}
async function removeRule(rule: Rule) {
  if (!confirm(`Delete "${rule.name}"?`)) return
  await supabase.from('automation_rules').delete().eq('id', rule.id)
  await load()
}

function openSendNow(rule: Rule) {
  sendNowForId.value = rule.id
  patientQuery.value = ''
  patients.value = []
  sentMessage.value = ''
}
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(patientQuery, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    if (!patientQuery.value.trim()) {
      patients.value = []
      return
    }
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .or(`first_name.ilike.%${patientQuery.value}%,last_name.ilike.%${patientQuery.value}%`)
      .limit(8)
    patients.value = data ?? []
  }, 250)
})
async function sendNow(patient: PatientOption) {
  if (!sendNowForId.value) return
  sending.value = true
  try {
    await $fetch('/api/automations/send-now', { method: 'POST', body: { ruleId: sendNowForId.value, patientId: patient.id } })
    sentMessage.value = `Sent to ${patient.first_name} ${patient.last_name ?? ''}`
    patientQuery.value = ''
    patients.value = []
  } catch {
    sentMessage.value = 'Failed to send.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">Campaigns</h1>
        <p class="mt-1 max-w-2xl text-sm text-gray-500">
          When something happens in QuiroFlow — a patient checks in, an appointment is completed, an invoice is
          paid — automatically send a WhatsApp template, an email, or call a webhook. Or skip the trigger and use
          "Send Now" to reach one patient right away.
        </p>
      </div>
      <button type="button" class="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" @click="openCreate">
        + New Campaign
      </button>
    </div>

    <div class="mt-6 rounded-lg border border-gray-200 bg-white">
      <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
      <div v-else-if="rules.length === 0" class="p-8 text-center text-sm text-gray-400">No campaigns yet.</div>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="rule in rules" :key="rule.id" class="p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-base font-medium text-gray-900">{{ rule.name }}</p>
              <p class="mt-0.5 text-sm text-gray-500">
                {{ TRIGGER_LABELS[rule.trigger_event] ?? rule.trigger_event }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="(a, i) in actionsByRule[rule.id] ?? []"
                  :key="i"
                  class="rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                >
                  {{ ACTION_LABELS[a.action_type] ?? a.action_type }}
                </span>
                <span v-if="(actionsByRule[rule.id] ?? []).length === 0" class="text-xs text-gray-400">No actions configured</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-3 text-sm">
              <label class="flex items-center gap-1.5 text-gray-500">
                <input type="checkbox" :checked="rule.enabled" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleEnabled(rule)" />
                Enabled
              </label>
              <button type="button" class="font-medium text-indigo-600 hover:text-indigo-500" @click="openSendNow(rule)">Send Now</button>
              <button type="button" class="font-medium text-indigo-600 hover:text-indigo-500" @click="openEdit(rule)">Edit</button>
              <button type="button" class="font-medium text-red-600 hover:text-red-700" @click="removeRule(rule)">Delete</button>
            </div>
          </div>

          <div v-if="sendNowForId === rule.id" class="mt-3 rounded-md bg-gray-50 p-3">
            <label class="block text-xs font-medium text-gray-600">Send this campaign to a patient right now</label>
            <input
              v-model="patientQuery"
              type="text"
              placeholder="Search patients…"
              class="mt-1 w-72 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <ul v-if="patients.length > 0" class="mt-1 max-h-40 w-72 overflow-y-auto rounded-md border border-gray-200 bg-white">
              <li
                v-for="p in patients"
                :key="p.id"
                class="cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-50"
                :class="{ 'pointer-events-none opacity-50': sending }"
                @click="sendNow(p)"
              >
                {{ p.first_name }} {{ p.last_name }}
              </li>
            </ul>
            <p v-if="sentMessage" class="mt-1 text-xs" :class="sentMessage.startsWith('Failed') ? 'text-red-600' : 'text-green-600'">{{ sentMessage }}</p>
          </div>
        </li>
      </ul>
    </div>

    <CampaignsAutomationModal v-if="modalOpen" :rule-id="editingRuleId" @close="modalOpen = false" @saved="onSaved" />
  </div>
</template>
