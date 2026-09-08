<script setup lang="ts">
// The one prominent pill shown near a patient's name. It reads the credit the
// patient actually holds (account_credits), not the netted balance of
// paid - invoiced + credit that it used to show.
//
// The netted figure was the confusing one at the front desk: a patient with
// 200 EUR of credit and a 240 EUR bono instalment outstanding showed as
// "40 Due", hiding both real numbers behind their difference. What reception
// needs at a glance is what the patient can draw sessions against, which is
// this; what they owe is on their invoices, where it can be collected.
const props = defineProps<{ creditCents: number }>()

const label = computed(() => `€${(props.creditCents / 100).toFixed(2)} Credit`)
</script>

<template>
  <UiPill v-if="creditCents > 0" tone="success">{{ label }}</UiPill>
</template>
