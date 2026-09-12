<script setup lang="ts">
// The one prominent figure shown near a patient's name: their balance, the way
// PracticeHub states it -- one number, positive when the clinic holds their
// money, negative when they owe.
//
// It has been three things. It began as this. It then became credit only, and
// then credit plus the euro value of unused bono sessions, labelled "in
// bonos". That last shape existed to paper over a mismatch: QuiroFlow kept a
// bono's value on its session counter while PracticeHub kept it in the
// balance, so reception comparing the two screens saw QuiroFlow claim zero
// where PracticeHub said 264 EUR, and the pill was where the missing money got
// put back.
//
// The re-migration removed the mismatch itself. Charges are now one per visit,
// as PracticeHub records them, so prepaid bono money sits in the balance and
// each visit draws it down -- pay 264, take a 44 EUR visit, the balance reads
// 220. There is nothing left for a second figure to explain.
//
// What it must NOT be read as is spendable credit. A balance is arithmetic
// over charges and payments; loose credit a patient can actually direct at an
// invoice is its own ledger, and that is what the "Credit on account" option
// is capped by -- not this.
const props = defineProps<{ balanceCents: number }>()

const label = computed(() => {
  const amount = `€${(Math.abs(props.balanceCents) / 100).toFixed(2)}`
  return props.balanceCents > 0 ? `${amount} credit` : `${amount} due`
})
</script>

<template>
  <UiPill v-if="props.balanceCents !== 0" :tone="props.balanceCents > 0 ? 'success' : 'danger'">{{ label }}</UiPill>
</template>
