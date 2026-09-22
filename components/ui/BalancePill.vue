<script setup lang="ts">
import { formatEur } from '~/utils/billing'
// The one prominent figure shown near a patient's name, for the front desk:
// what this patient can draw on right now.
//
// It has been several things. It began as the balance, became credit only,
// then credit plus the euro value of unused bono sessions, then the balance
// again after the re-migration -- on the reasoning that prepaid bono money
// sits in the balance and each visit draws it down, so one number said it all.
//
// That reasoning does not survive contact with the data. The balance is
// arithmetic over every charge and payment a patient has ever had, so it
// carries three years of imported PracticeHub history with it, and for 139 of
// the 217 patients showing a positive one it disagrees with what they can
// actually use -- Adela Andrade read "281.00 credit" beside an Available of
// 120. Worse, it said "credit", which is the one thing this figure is not:
// bono money is already committed to the sessions it bought, and the loose
// credit a patient can direct at an invoice is its own ledger.
//
// So the pill now shows availableCents, the same number the Billing tab calls
// Available: loose account credit plus what the unused bono sessions are
// worth, net of anything still owed on those bonos. That is the question the
// front desk is asking when they glance at it -- "has this person got anything
// left, or do I need to charge them?".
//
// Net, because gross was a second way of being wrong: a patient who had put
// 150 EUR down on a 528 EUR bono and used one session read "484 available"
// while the Debtors report, on the same day, listed him as owing 378. Netting
// the debt off leaves 106 -- which is what he has paid beyond what he has been
// invoiced, so the pill and the balance finally describe the same patient.
//
// The debt side still comes from the balance, because owing money is not the
// absence of available money: a patient can hold four unused sessions and
// still owe for a visit taken outside the bono. Available is checked first, so
// the pill answers "what can they use" when there is anything to use, and
// falls back to what they owe when there is not.
const props = defineProps<{
  /** Loose credit + unused bono value less bono debt -- what they can spend. */
  availableCents: number
  /** Negative when the patient owes; only the owing side is read from it. */
  balanceCents: number
}>()

const t = useT()

const label = computed(() => {
  if (props.availableCents > 0) {
    return `${formatEur(props.availableCents)} ${t('available', 'disponible')}`
  }
  return `${formatEur(Math.abs(props.balanceCents))} ${t('due', 'pendiente')}`
})
const tone = computed(() => (props.availableCents > 0 ? 'success' : 'danger'))
const show = computed(() => props.availableCents > 0 || props.balanceCents < 0)
</script>

<template>
  <UiPill v-if="show" :tone="tone">{{ label }}</UiPill>
</template>
