<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
}

const supabase = useSupabaseClient()
const { context, loading: contextLoading } = usePractitionerContext()
const appointments = ref<Appointment[]>([])
const loading = ref(true)

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function load() {
  if (!context.value?.clinicId) {
    appointments.value = []
    loading.value = false
    return
  }
  loading.value = true
  const start = startOfToday()
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const { data } = await supabase
    .from('appointments')
    .select('id, patient_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, patients(first_name, last_name), appointment_types(name, color)')
    .eq('clinic_id', context.value.clinicId)
    .eq('practitioner_id', context.value.teamMemberId)
    .neq('status', 'cancelled')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .order('starts_at')
  appointments.value = (data as unknown as Appointment[]) ?? []
  loading.value = false
}

watch(context, load, { immediate: true })

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function statusLabel(a: Appointment) {
  if (a.status === 'completed') return 'Completed'
  if (a.flow_with_practitioner_at) return 'In room'
  if (a.checked_in_at) return 'Checked in'
  return 'Upcoming'
}
function statusClass(a: Appointment) {
  if (a.status === 'completed') return 'bg-surface-subtle text-ink-muted2'
  if (a.flow_with_practitioner_at) return 'bg-brand-tint text-brand-text'
  if (a.checked_in_at) return 'bg-success-bg text-success-text'
  return 'bg-chip-bg text-chip-text'
}

async function checkIn(a: Appointment) {
  await supabase.from('appointments').update({ checked_in_at: new Date().toISOString() } as never).eq('id', a.id)
  await load()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-line bg-surface px-4 py-3">
      <h1 class="text-[17px] font-semibold text-ink-900">My Day</h1>
      <p class="text-[12.5px] text-ink-muted2">{{ new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) }}</p>
    </div>

    <div v-if="contextLoading || loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="appointments.length === 0" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">No appointments today.</p>

    <div v-else class="flex-1 space-y-2 overflow-y-auto px-3 py-3">
      <div v-for="a in appointments" :key="a.id" class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[14px] font-[600] text-ink-900">{{ formatTime(a.starts_at) }} — {{ a.patients?.first_name }} {{ a.patients?.last_name ?? '' }}</p>
            <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ a.appointment_types?.name ?? 'Appointment' }}</p>
          </div>
          <span class="shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium" :class="statusClass(a)">{{ statusLabel(a) }}</span>
        </div>
        <button
          v-if="!a.checked_in_at && a.status !== 'completed'"
          type="button"
          class="mt-2.5 rounded-ctl border border-line-control px-3 py-1.5 text-[12.5px] font-medium text-brand-text active:bg-surface-subtle"
          @click="checkIn(a)"
        >
          Check in
        </button>
      </div>
    </div>
  </div>
</template>
