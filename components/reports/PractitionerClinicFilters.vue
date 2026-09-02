<script setup lang="ts">
import type { FilterOption } from '~/composables/useReportFilterOptions'

defineProps<{ practitioners: FilterOption[]; clinics: FilterOption[]; showClinic?: boolean }>()
const practitionerId = defineModel<string>('practitionerId', { default: '' })
const clinicId = defineModel<string>('clinicId', { default: '' })
const t = useT()
</script>

<template>
  <select v-model="practitionerId" class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
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
