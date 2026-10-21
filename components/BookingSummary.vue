<script setup lang="ts">
const props = defineProps<{
  // timezone: the slot is shown on the clinic's clock, which is the one the
  // appointment is kept on, not the visitor's.
  clinic: { name: string; address: string | null; timezone?: string | null } | null
  appointmentType: { name: string } | null
  priceCents: number
  teamMember: { full_name: string } | null
  slot: Date | null
  formatPrice: (cents: number) => string
  onlinePaymentRequired?: boolean
  depositCents?: number | null
}>()

const dueNowCents = computed(() => {
  if (!props.onlinePaymentRequired) return 0
  return props.depositCents ?? props.priceCents
})
const timeZone = computed(() => props.clinic?.timezone || 'Europe/Madrid')
const { locale, say } = useBookingLang()
const dueAtVisitCents = computed(() => (props.onlinePaymentRequired ? props.priceCents - dueNowCents.value : props.priceCents))
</script>

<template>
  <div class="h-fit rounded-card border border-line bg-surface p-5 shadow-card">
    <h3 class="text-sm font-semibold text-ink-900">{{ say({ es: 'Resumen de la reserva', en: 'Booking summary', fr: 'Récapitulatif de la réservation' }) }}</h3>
    <div class="mt-3 space-y-3 text-sm">
      <div v-if="clinic">
        <p class="font-medium text-ink-900">{{ clinic.name }}</p>
        <p v-if="clinic.address" class="text-ink-muted">{{ clinic.address }}</p>
      </div>
      <div v-if="appointmentType" class="flex items-center justify-between border-t border-line-divider pt-3">
        <span class="text-ink-700">{{ appointmentType.name }}</span>
        <span class="font-medium text-ink-900">{{ formatPrice(priceCents) }}</span>
      </div>
      <div v-if="appointmentType && onlinePaymentRequired !== undefined" class="space-y-1 border-t border-line-divider pt-3 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-ink-muted">{{ say({ es: 'Pagar ahora', en: 'Pay now', fr: 'À payer maintenant' }) }}</span>
          <span class="font-medium text-ink-900">{{ formatPrice(dueNowCents) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-ink-muted">{{ say({ es: 'Pagar en la consulta', en: 'Pay at the clinic', fr: 'À payer au cabinet' }) }}</span>
          <span class="font-medium text-ink-900">{{ formatPrice(dueAtVisitCents) }}</span>
        </div>
      </div>
      <div v-if="teamMember" class="border-t border-line-divider pt-3 text-ink-700">
        {{ teamMember.full_name }}
      </div>
      <div v-if="slot" class="border-t border-line-divider pt-3 text-ink-700">
        {{ slot.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }) }}
        · {{ slot.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }) }}
      </div>
    </div>
  </div>
</template>
