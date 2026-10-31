<script setup lang="ts">
import type { CareStop } from '~/composables/useCareStopReasons'

// "Stopped coming" on a patient's record: the reason they gave, if one has
// been recorded since their last visit (current_care_stops), who recorded it
// and when. Recorded, changed and cleared here as from Recalls; once the
// patient attends again it is history, counted in Reports > Retention and no
// longer shown.
//
// Not offered at all to a patient with a visit booked and nothing recorded:
// "Stopped coming -- Record reason" sat on the record of someone coming next
// week. A reason already recorded still shows, booked or not: it is a fact
// somebody wrote down, and a booking does not unsay it.
const props = defineProps<{ patient: { id: string; first_name: string; last_name?: string | null }; booked?: boolean }>()

const supabase = useSupabaseClient()
const t = useT()
const { can } = usePermission()
const { reasons, load: loadReasons, nameOf, fetchCurrent } = useCareStopReasons()

const current = ref<CareStop | null>(null)
const recordedBy = ref<string | null>(null)
const loading = ref(true)
const editing = ref(false)
const canRecord = computed(() => can('recalls_access') || can('patients_edit'))

async function load() {
  const [stops] = await Promise.all([fetchCurrent([props.patient.id]), loadReasons()])
  current.value = stops[props.patient.id] ?? null
  recordedBy.value = null
  if (current.value?.recorded_by) {
    const { data } = await supabase.from('team_members').select('full_name').eq('id', current.value.recorded_by).maybeSingle()
    recordedBy.value = data?.full_name ?? null
  }
  loading.value = false
}
onMounted(load)
watch(() => props.patient.id, load)

function onSaved() {
  editing.value = false
  load()
}
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const name = computed(() => `${props.patient.first_name} ${props.patient.last_name ?? ''}`.trim())
</script>

<template>
  <section v-if="loading ? !booked : current || !booked" aria-labelledby="ov-care-stop" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-care-stop">
    <div class="flex items-center justify-between gap-2">
      <h2 id="ov-care-stop" class="text-[13.5px] font-semibold text-ink-700">{{ t('Stopped coming', 'Baja') }}</h2>
      <button v-if="canRecord && !loading" type="button" class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus" data-cy="care-stop-edit" @click="editing = true">
        {{ current ? t('Change', 'Cambiar') : t('Record reason', 'Registrar motivo') }}
      </button>
    </div>
    <UiSkeleton v-if="loading" class="mt-3 h-4 w-40 rounded-ctlSm" />
    <div v-else-if="current" class="mt-2.5" data-cy="care-stop-current">
      <p class="text-[14px] font-semibold text-ink-900" data-cy="care-stop-reason-name">{{ nameOf(current.reason_id) }}</p>
      <p v-if="current.note" class="mt-0.5 whitespace-pre-line text-[13px] text-ink-700">{{ current.note }}</p>
      <p class="mt-1 text-[12px] text-ink-muted">{{ [when(current.recorded_at), recordedBy].filter(Boolean).join(' · ') }}</p>
    </div>
    <p v-else class="mt-2.5 text-[13px] text-ink-faint">{{ t('No reason recorded since their last visit.', 'Sin motivo registrado desde su última visita.') }}</p>

    <PatientsCareStopDialog v-if="editing" :patient-id="patient.id" :patient-name="name" :reasons="reasons" :current="current" @close="editing = false" @saved="onSaved" />
  </section>
</template>
