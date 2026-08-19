<script setup lang="ts">
import type { FilterOption } from '~/composables/useReportFilterOptions'

defineProps<{ practitioners: FilterOption[]; clinics: FilterOption[]; showClinic?: boolean }>()
const practitionerId = defineModel<string>('practitionerId', { default: '' })
const clinicId = defineModel<string>('clinicId', { default: '' })
</script>

<template>
  <select v-model="practitionerId" class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
    <option value="">All practitioners</option>
    <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.name }}</option>
  </select>
  <select
    v-if="showClinic !== false && clinics.length > 1"
    v-model="clinicId"
    class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
  >
    <option value="">All clinics</option>
    <option v-for="c in clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
  </select>
</template>
