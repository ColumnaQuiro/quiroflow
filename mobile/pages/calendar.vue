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
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
  team_members: { full_name: string } | null
}

const supabase = useSupabaseClient()
const { context, loading: contextLoading } = usePractitionerContext()
const appointments = ref<Appointment[]>([])
const loading = ref(true)
const anchorDate = ref(new Date())

function startOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}
function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

async function load() {
  if (!context.value?.clinicId) {
    appointments.value = []
    loading.value = false
    return
  }
  loading.value = true
  const start = startOfDay(anchorDate.value)
  const end = addDays(start, 1)
  let query = supabase
    .from('appointments')
    .select('id, patient_id, starts_at, ends_at, status, patients(first_name, last_name), appointment_types(name, color), team_members(full_name)')
    .eq('clinic_id', context.value.clinicId)
    .neq('status', 'cancelled')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .order('starts_at')
  if (!context.value.isOwner) query = query.eq('practitioner_id', context.value.teamMemberId)
  const { data } = await query
  appointments.value = (data as unknown as Appointment[]) ?? []
  loading.value = false
}

watch([context, anchorDate], load, { immediate: true })

function shiftDay(n: number) {
  anchorDate.value = addDays(anchorDate.value, n)
}
function isToday() {
  return startOfDay(anchorDate.value).getTime() === startOfDay(new Date()).getTime()
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between border-b border-line bg-surface px-3 py-2.5">
      <button type="button" class="flex h-9 w-9 items-center justify-center text-[16px] text-ink-muted" @click="shiftDay(-1)">&larr;</button>
      <div class="text-center">
        <p class="text-[14px] font-[600] text-ink-900">{{ anchorDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) }}</p>
        <button v-if="!isToday()" type="button" class="text-[11.5px] text-brand-text" @click="anchorDate = new Date()">Today</button>
      </div>
      <button type="button" class="flex h-9 w-9 items-center justify-center text-[16px] text-ink-muted" @click="shiftDay(1)">&rarr;</button>
    </div>

    <div v-if="contextLoading || loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="appointments.length === 0" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">No appointments this day.</p>

    <div v-else class="flex-1 space-y-2 overflow-y-auto px-3 py-3">
      <NuxtLink
        v-for="a in appointments"
        :key="a.id"
        :to="`/calendar/${a.id}`"
        class="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 shadow-card active:bg-surface-subtle"
      >
        <span class="h-full w-1 shrink-0 self-stretch rounded-full" :style="{ backgroundColor: a.appointment_types?.color || '#ddd' }" />
        <div class="min-w-0 flex-1">
          <p class="text-[13.5px] font-[600]" :class="a.status === 'completed' ? 'text-ink-faint line-through' : 'text-ink-900'">
            {{ formatTime(a.starts_at) }} · {{ a.patients?.first_name }} {{ a.patients?.last_name ?? '' }}
          </p>
          <p class="truncate text-[12px] text-ink-muted2">
            {{ a.appointment_types?.name ?? 'Appointment' }}<template v-if="a.team_members"> · {{ a.team_members.full_name }}</template>
          </p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
