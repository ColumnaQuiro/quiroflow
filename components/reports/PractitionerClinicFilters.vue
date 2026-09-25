<script setup lang="ts">
import type { FilterOption } from '~/composables/useReportFilterOptions'

// `lockedTo`: the practitioner this viewer is limited to (reports_own_only,
// or dashboard_scope 'own'). The select is replaced by a plain label rather
// than disabled -- a disabled "All practitioners" list would suggest the
// others exist and are merely out of reach, and offering them would be the
// leak itself. The model is pinned too, so a page that forgot to start from
// the locked id still cannot show anyone else's figures.
const props = defineProps<{ practitioners: FilterOption[]; clinics: FilterOption[]; showClinic?: boolean; lockedTo?: string | null }>()
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
  <span v-if="lockedTo" data-cy="report-own-only" class="inline-flex h-8 items-center rounded-pill bg-chip-bg px-3 text-[12.5px] font-semibold text-chip-text">
    {{ t('Only your own figures', 'Solo tus datos') }}
  </span>
  <select v-else v-model="practitionerId" data-cy="report-practitioner-filter" class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
    <option value="">{{ t('All practitioners', 'Todos los profesionales') }}</option>
    <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.name }}</option>
  </select>
  <select
    v-if="showClinic !== false && clinics.length > 1"
    v-model="clinicId"
    class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
  >
    <option value="">{{ t('All clinics', 'Todas las clínicas') }}</option>
    <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
  </select>
</template>
