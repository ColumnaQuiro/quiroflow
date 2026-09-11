<script setup lang="ts">
// The one prominent pill shown near a patient's name: what this patient can
// draw on, in money. Reception's actual question is "how much do they have
// left?", and a patient asks it the same way -- in euros, never in rows of a
// ledger.
//
// It is NOT the netted balance of paid - invoiced + credit it once showed.
// That hid both real numbers behind their difference: 200 EUR of credit with a
// 240 EUR bono instalment outstanding rendered as "40 Due". What is owed lives
// on the invoices, where it can actually be collected.
//
// Nor is it account_credits alone, which is what it read until now. Since a
// bono visit stopped being a billing event (0161), a bono's remaining value
// lives on its sessions counter and NOT as credit -- so a patient with ten
// prepaid sessions left showed "no credit", and the pill went blank for
// essentially every bono holder in the account. PracticeHub, which the clinic
// is still dual-running against, shows that same money in its `balance`
// column, so reception comparing the two screens saw QuiroFlow claim zero
// where PracticeHub said 264 EUR.
//
// availableCents is loose credit + bono value. A summary, not a second
// balance: nothing spends from it (a session comes off its own counter, credit
// off the ledger), so surfacing it cannot let the same euros be spent twice.
const props = defineProps<{
  creditCents: number
  bonoValueCents?: number
}>()

const totalCents = computed(() => props.creditCents + (props.bonoValueCents ?? 0))

// Split when both halves exist, so the number is traceable to where it lives
// rather than being one figure staff cannot reconcile against anything.
const label = computed(() => {
  const total = `€${(totalCents.value / 100).toFixed(2)}`
  const bono = props.bonoValueCents ?? 0
  if (bono > 0 && props.creditCents > 0) {
    return `${total} available (€${(bono / 100).toFixed(2)} in bonos)`
  }
  if (bono > 0) return `${total} in bonos`
  return `${total} Credit`
})
</script>

<template>
  <UiPill v-if="totalCents > 0" tone="success">{{ label }}</UiPill>
</template>
