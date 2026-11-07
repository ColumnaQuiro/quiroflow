<script setup lang="ts">
// The practitioner and clinic filters, as the web's
// components/reports/PractitionerClinicFilters.vue: `lockedTo` (reports_own_only)
// replaces the practitioner choice with a plain "only your own figures" pill
// and pins the model to it, so a report that forgot to start from the locked
// id still cannot show anyone else's. The clinic choice only with two or more.
import type { FilterOption } from '../../composables/useReportFilterOptions'

const props = withDefaults(defineProps<{ practitioners: FilterOption[]; clinics: FilterOption[]; showClinic?: boolean; showPractitioner?: boolean; lockedTo?: string | null }>(), {
  showClinic: true,
  showPractitioner: true,
  lockedTo: null,
})
const practitionerId = defineModel<string>('practitionerId', { default: '' })
const clinicId = defineModel<string>('clinicId', { default: '' })
const t = useT()

watch(
  () => props.lockedTo,
  (locked) => {
    if (locked && practitionerId.value !== locked) practitionerId.value = locked
  },
  { immediate: true },
)
</script>

<template>
  <template v-if="showPractitioner">
    <span v-if="lockedTo" class="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-chip-bg px-3 text-[12.5px] font-semibold text-chip-text" data-cy="report-own-only">
      {{ t('Only your own figures', 'Solo tus datos') }}
    </span>
    <ReportSelect v-else v-model="practitionerId" :options="practitioners" :all-label="t('All practitioners', 'Todos los profesionales')" :label="t('Practitioner', 'Profesional')" data-cy="report-practitioner-filter" />
  </template>
  <ReportSelect v-if="showClinic && clinics.length > 1" v-model="clinicId" :options="clinics" :all-label="t('All clinics', 'Todas las clínicas')" :label="t('Clinic', 'Clínica')" data-cy="report-clinic-filter" />
</template>
