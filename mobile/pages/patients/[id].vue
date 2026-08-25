<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const patientId = route.params.id as string

interface Patient {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  date_of_birth: string | null
}
interface ContactNumber { number: string; country_code: string; is_whatsapp: boolean }
interface Appointment {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

const supabase = useSupabaseClient()
const patient = ref<Patient | null>(null)
const numbers = ref<ContactNumber[]>([])
const nextAppointment = ref<Appointment | null>(null)
const loading = ref(true)

onMounted(async () => {
  const [{ data: p }, { data: nums }, { data: appts }] = await Promise.all([
    supabase.from('patients').select('id, first_name, last_name, email, date_of_birth').eq('id', patientId).maybeSingle(),
    supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp').eq('patient_id', patientId),
    supabase
      .from('appointments')
      .select('id, starts_at, status, appointment_types(name)')
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(1),
  ])
  patient.value = p
  numbers.value = nums ?? []
  nextAppointment.value = ((appts as unknown as Appointment[]) ?? [])[0] ?? null
  loading.value = false
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <NuxtLink to="/patients" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text">&larr;</NuxtLink>
      <p class="truncate text-[15px] font-[600] text-ink-900">Patient</p>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="!patient" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">Patient not found.</p>

    <div v-else class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div class="flex items-center gap-3">
        <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[18px] font-semibold text-brand-text">
          {{ patient.first_name.slice(0, 1).toUpperCase() }}{{ (patient.last_name ?? '').slice(0, 1).toUpperCase() }}
        </span>
        <div class="min-w-0">
          <p class="truncate text-[17px] font-semibold text-ink-900">{{ patient.first_name }} {{ patient.last_name ?? '' }}</p>
          <p v-if="patient.date_of_birth" class="text-[12.5px] text-ink-muted2">Born {{ new Date(patient.date_of_birth).toLocaleDateString() }}</p>
        </div>
      </div>

      <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Contact</p>
        <p v-if="patient.email" class="text-[13.5px] text-ink-700">{{ patient.email }}</p>
        <p v-for="n in numbers" :key="n.number" class="text-[13.5px] text-ink-700">
          +{{ n.country_code }} {{ n.number }} <span v-if="n.is_whatsapp" class="text-[11px] text-success-text">WhatsApp</span>
        </p>
        <p v-if="!patient.email && numbers.length === 0" class="text-[13px] text-ink-faint">No contact info on file.</p>
      </div>

      <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Next appointment</p>
        <p v-if="nextAppointment" class="text-[13.5px] text-ink-700">
          {{ formatDate(nextAppointment.starts_at) }} — {{ nextAppointment.appointment_types?.name ?? 'Appointment' }}
        </p>
        <p v-else class="text-[13px] text-ink-faint">Nothing scheduled.</p>
      </div>
    </div>
  </div>
</template>
