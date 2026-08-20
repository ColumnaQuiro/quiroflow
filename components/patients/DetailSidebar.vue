<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patient: Tables<'patients'> }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

interface TeamMemberOption { id: string; full_name: string }
const teamMembers = ref<TeamMemberOption[]>([])
const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)
const nextAppointment = ref<{ starts_at: string; appointment_types: { name: string } | null } | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  const [{ data: members }, { data: numbers }, { data: appt }] = await Promise.all([
    supabase.from('team_members').select('id, full_name').order('full_name'),
    supabase.from('patient_contact_numbers').select('*').eq('patient_id', props.patient.id).order('created_at').limit(1),
    supabase
      .from('appointments')
      .select('starts_at, appointment_types(name)')
      .eq('patient_id', props.patient.id)
      .eq('status', 'booked')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(1)
      .maybeSingle(),
  ])
  teamMembers.value = members ?? []
  primaryNumber.value = numbers?.[0] ?? null
  nextAppointment.value = (appt as unknown as typeof nextAppointment.value) ?? null
  loading.value = false
}
onMounted(load)
watch(() => props.patient.id, load)

function initials() {
  const a = props.patient.first_name?.[0] ?? ''
  const b = props.patient.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}
function teamMemberName(id: string | null) {
  return teamMembers.value.find((m) => m.id === id)?.full_name ?? 'None'
}
function clinicName(id: string | null) {
  return store.clinics.find((c) => c.id === id)?.name ?? 'None'
}
function formatBalance(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  if (cents > 0) return { text: `€${amount} in credit`, class: 'text-green-600' }
  if (cents < 0) return { text: `€${amount} owing`, class: 'text-red-600' }
  return { text: '€0.00', class: 'text-gray-500' }
}

const whatsAppOpen = ref(false)
</script>

<template>
  <aside class="w-full shrink-0 space-y-4 lg:sticky lg:top-0 lg:max-h-screen lg:w-72 lg:overflow-y-auto lg:pb-6">
    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-base font-semibold text-indigo-700">
          {{ initials() }}
        </span>
        <div class="min-w-0">
          <p class="truncate font-semibold text-gray-900">{{ patient.first_name }} {{ patient.last_name }}</p>
          <p class="text-sm" :class="formatBalance(patient.balance_cents).class">{{ formatBalance(patient.balance_cents).text }}</p>
        </div>
      </div>

      <button
        v-if="primaryNumber"
        type="button"
        class="mt-4 w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        @click="whatsAppOpen = true"
      >
        Send WhatsApp
      </button>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Contact</h3>
      <dl class="mt-3 space-y-2 text-sm">
        <div>
          <dt class="text-gray-400">Email</dt>
          <dd class="text-gray-900">{{ patient.email ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-gray-400">Phone</dt>
          <dd class="text-gray-900">
            <span v-if="primaryNumber">{{ countryByCode(primaryNumber.country_code).flag }} {{ countryByCode(primaryNumber.country_code).dial }} {{ primaryNumber.number }}</span>
            <span v-else>N/A</span>
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="patient.tags.length > 0" class="rounded-lg border border-gray-200 bg-white p-5">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Tags</h3>
      <div class="mt-3 flex flex-wrap gap-1.5">
        <span v-for="tag in patient.tags" :key="tag" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{{ tag }}</span>
      </div>
    </div>

    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">Quick Facts</h3>
      <dl class="mt-3 space-y-2 text-sm">
        <div class="flex justify-between gap-2">
          <dt class="text-gray-400">Practitioner</dt>
          <dd class="text-right text-gray-900">{{ loading ? '…' : teamMemberName(patient.default_practitioner_id) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-gray-400">Clinic</dt>
          <dd class="text-right text-gray-900">{{ clinicName(patient.clinic_id) }}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-gray-400">Next visit</dt>
          <dd class="text-right text-gray-900">
            <template v-if="loading">…</template>
            <template v-else-if="nextAppointment">
              {{ new Date(nextAppointment.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}
            </template>
            <template v-else>None</template>
          </dd>
        </div>
      </dl>
    </div>

    <SendWhatsAppModal
      v-if="whatsAppOpen"
      :patient-id="patient.id"
      :patient-first-name="patient.first_name"
      :patient-preferred-language="patient.preferred_language"
      @close="whatsAppOpen = false"
      @sent="whatsAppOpen = false"
    />
  </aside>
</template>
