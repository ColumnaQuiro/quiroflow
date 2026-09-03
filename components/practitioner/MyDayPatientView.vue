<script setup lang="ts">
interface RoomOption { id: string; name: string }
interface Appointment {
  id: string
  patient_id: string
  room_id: string | null
  starts_at: string
  status: string
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
}

const props = defineProps<{ appointment: Appointment; rooms?: RoomOption[] }>()
const emit = defineEmits<{ charted: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const visitNumber = ref<number | null>(null)
const signing = ref(false)

// Same completed/cancelled/no_show/show-rate computation as
// PatientsAppointmentsTab's stat strip -- kept local here (not in
// PatientsPhaseStats) since the patient-detail rail's Care plan card has a
// fixed shape per its own design spec, but a practitioner charting mid-visit
// still benefits from "has this patient been missing visits?" at a glance.
const attendanceLoading = ref(true)
const attendance = ref({ completed: 0, cancelled: 0, no_show: 0 })
const showRate = computed(() => {
  const denom = attendance.value.completed + attendance.value.no_show
  if (denom === 0) return null
  return Math.round((attendance.value.completed / denom) * 100)
})
async function loadAttendance() {
  attendanceLoading.value = true
  const { data } = await supabase.from('appointments').select('status').eq('patient_id', props.appointment.patient_id)
  const next = { completed: 0, cancelled: 0, no_show: 0 }
  for (const a of data ?? []) {
    if (a.status in next) (next as Record<string, number>)[a.status]++
  }
  attendance.value = next
  attendanceLoading.value = false
}
watch(() => props.appointment.patient_id, loadAttendance, { immediate: true })

// PatientsExamAutofill owns the SOAP fields and the visit_notes save --
// this view just drives it (save on "Sign & complete", populate on "Copy
// last note") via the methods it exposes.
const examRef = ref<{ save: () => Promise<void>; copyLastNote: () => Promise<void> } | null>(null)

async function loadVisitNumber() {
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', props.appointment.patient_id)
    .neq('status', 'cancelled')
    .lte('starts_at', props.appointment.starts_at)
  visitNumber.value = count ?? null
}
watch(() => props.appointment.id, loadVisitNumber, { immediate: true })

const initials = computed(() => {
  const f = props.appointment.patients?.first_name?.[0] ?? ''
  const l = props.appointment.patients?.last_name?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
})
const patientName = computed(() => `${props.appointment.patients?.first_name ?? ''} ${props.appointment.patients?.last_name ?? ''}`.trim())
const roomName = computed(() => props.rooms?.find((r) => r.id === props.appointment.room_id)?.name ?? null)
const visitLine = computed(() => {
  const parts = [
    new Date(props.appointment.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    props.appointment.appointment_types?.name ?? t('No type', 'Sin tipo'),
  ]
  if (roomName.value) parts.push(roomName.value)
  const prefix = visitNumber.value ? `${t('Visit', 'Visita')} #${visitNumber.value} · ` : ''
  return prefix + parts.join(' · ')
})

async function copyLastNote() {
  await examRef.value?.copyLastNote()
}

async function signAndComplete() {
  signing.value = true
  // Status first, note second: ExamAutofill's save() fires its own 'saved'
  // -> 'charted' reload the moment a first note is created, and that reload
  // re-fetches this appointment's status. Doing the status update after
  // that save would race it -- the reload can win and land before the
  // update commits, showing "Booked" until the next refresh. Flipping the
  // order means any reload the save triggers already sees "completed".
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointment.id)
  await examRef.value?.save()
  signing.value = false
  emit('charted')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Charting card -->
    <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-[650] text-brand">
            {{ initials }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-[15px] font-[600] text-ink-900">{{ patientName }}</p>
            <p class="truncate text-[12.5px] text-ink-muted2">{{ visitLine }}</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <NuxtLink :to="`/patients/${appointment.patient_id}`" target="_blank" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover">
            {{ t('View profile →', 'Ver perfil →') }}
          </NuxtLink>
          <UiBtn variant="secondary" size="sm" @click="copyLastNote">{{ t('Copy last note', 'Copiar última nota') }}</UiBtn>
          <UiBtn variant="primary" size="sm" :disabled="signing" @click="signAndComplete">{{ signing ? t('Signing…', 'Firmando…') : t('Sign & complete', 'Firmar y completar') }}</UiBtn>
        </div>
      </div>

      <PatientsExamAutofill ref="examRef" :appointment-id="appointment.id" :patient-id="appointment.patient_id" @saved="emit('charted')" />
    </div>

    <div class="grid grid-cols-3 gap-4">
      <div class="col-span-1 space-y-4">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Attendance', 'Asistencia') }}</p>
          <div class="mt-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <p class="text-[11px] text-ink-muted2">{{ t('Completed', 'Completadas') }}</p>
              <p class="mt-0.5 font-mono text-[16px] font-semibold text-success-text">{{ attendanceLoading ? '—' : attendance.completed }}</p>
            </div>
            <div>
              <p class="text-[11px] text-ink-muted2">{{ t('Missed', 'No asistidas') }}</p>
              <p class="mt-0.5 font-mono text-[16px] font-semibold text-danger-text">{{ attendanceLoading ? '—' : attendance.no_show }}</p>
            </div>
            <div>
              <p class="text-[11px] text-ink-muted2">{{ t('Cancelled', 'Canceladas') }}</p>
              <p class="mt-0.5 font-mono text-[16px] font-semibold text-warning-accent">{{ attendanceLoading ? '—' : attendance.cancelled }}</p>
            </div>
            <div>
              <p class="text-[11px] text-ink-muted2">{{ t('Show rate', 'Tasa de asistencia') }}</p>
              <p class="mt-0.5 font-mono text-[16px] font-semibold text-ink-900">{{ attendanceLoading || showRate === null ? '—' : `${showRate}%` }}</p>
            </div>
          </div>
        </div>
        <PatientsPhaseStats :patient-id="appointment.patient_id" />
        <PatientsFlagsPanel :patient-id="appointment.patient_id" />
      </div>
      <div class="col-span-2 space-y-4">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-700">{{ t('Quick Note', 'Nota rápida') }}</h3>
          <div class="mt-2">
            <AppointmentsNotesPanel :appointment-id="appointment.id" />
          </div>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-700">{{ t('Notes History', 'Historial de notas') }}</h3>
          <div class="mt-2">
            <PatientsVisitNotesTab :patient-id="appointment.patient_id" />
          </div>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-700">{{ t('Files & Documents', 'Archivos y documentos') }}</h3>
          <div class="mt-2">
            <PatientsFilesTab :patient-id="appointment.patient_id" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
