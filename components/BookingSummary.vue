<script setup lang="ts">
const props = defineProps<{
  // timezone: the slot is shown on the clinic's clock, which is the one the
  // appointment is kept on, not the visitor's.
  clinic: { name: string; address: string | null; timezone?: string | null } | null
  appointmentType: { name: string } | null
  priceCents: number
  // Minutes, for the line under the service; left out where it is not known.
  durationMinutes?: number
  teamMember: { full_name: string } | null
  slot: Date | null
  formatPrice: (cents: number) => string
  onlinePaymentRequired?: boolean
  depositCents?: number | null
  // A line where the date will go, once the patient is choosing one.
  awaitingSlot?: boolean
}>()

const dueNowCents = computed(() => {
  if (!props.onlinePaymentRequired) return 0
  return props.depositCents ?? props.priceCents
})
const timeZone = computed(() => props.clinic?.timezone || 'Europe/Madrid')
const { locale, say } = useBookingLang()
const dueAtVisitCents = computed(() => (props.onlinePaymentRequired ? props.priceCents - dueNowCents.value : props.priceCents))
const initials = computed(() =>
  (props.teamMember?.full_name ?? '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join(''),
)
</script>

<template>
  <div class="h-fit rounded-card border border-line bg-surface px-5 pb-5 pt-4 shadow-card" data-cy="booking-summary">
    <h3 class="text-[15px] font-semibold text-ink-900">{{ say({ es: 'Resumen de la reserva', en: 'Booking summary', fr: 'Récapitulatif de la réservation' }) }}</h3>
    <div class="mt-1 divide-y divide-line-divider text-sm">
      <div v-if="clinic" class="flex gap-3 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text" aria-hidden="true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
        </span>
        <div class="min-w-0">
          <p class="font-semibold text-ink-900">{{ clinic.name }}</p>
          <p v-if="clinic.address" class="whitespace-pre-line text-ink-muted">{{ clinic.address }}</p>
        </div>
      </div>
      <div v-if="appointmentType" class="flex gap-3 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text" aria-hidden="true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-3">
            <p class="font-semibold text-ink-900">{{ appointmentType.name }}</p>
            <span class="shrink-0 font-mono font-medium text-ink-900">{{ formatPrice(priceCents) }}</span>
          </div>
          <p v-if="durationMinutes" class="text-ink-muted">{{ durationMinutes }} min</p>
          <div v-if="onlinePaymentRequired !== undefined" class="mt-1.5 space-y-0.5 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-ink-muted">{{ say({ es: 'Pagar ahora', en: 'Pay now', fr: 'À payer maintenant' }) }}</span>
              <span class="font-mono font-medium text-ink-900">{{ formatPrice(dueNowCents) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-ink-muted">{{ say({ es: 'Pagar en la consulta', en: 'Pay at the clinic', fr: 'À payer au cabinet' }) }}</span>
              <span class="font-mono font-medium text-ink-900">{{ formatPrice(dueAtVisitCents) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="teamMember" class="flex items-center gap-3 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text" aria-hidden="true">{{ initials }}</span>
        <p class="font-semibold text-ink-900">{{ teamMember.full_name }}</p>
      </div>
      <div v-if="slot || awaitingSlot" class="flex items-center gap-3 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text" aria-hidden="true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
        </span>
        <p v-if="slot" class="font-semibold text-ink-900" data-cy="booking-summary-slot">
          {{ slot.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }) }}
          · {{ slot.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }) }}
        </p>
        <p v-else class="text-ink-faint">{{ say({ es: 'Elija día y hora', en: 'Choose a day and time', fr: 'Choisissez le jour et l’heure' }) }}</p>
      </div>
    </div>
    <slot />
  </div>
</template>
