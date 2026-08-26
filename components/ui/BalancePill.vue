<script setup lang="ts">
// The one prominent "€X Credit" / "€X Due" badge shown near a patient's name,
// matching PracticeHub's patient-header pill -- backed by the same balanceCents
// usePatientFinancialSummary already computes (paid - invoiced + account credit),
// just never surfaced this visibly before.
const props = defineProps<{ balanceCents: number }>()

const label = computed(() => `€${(Math.abs(props.balanceCents) / 100).toFixed(2)} ${props.balanceCents < 0 ? 'Due' : 'Credit'}`)
</script>

<template>
  <UiPill v-if="balanceCents !== 0" :tone="balanceCents < 0 ? 'danger' : 'success'">{{ label }}</UiPill>
</template>
