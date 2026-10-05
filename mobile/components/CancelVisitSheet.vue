<script setup lang="ts">
// Cancelling a visit from the app: the web's cancel step
// (components/calendar/CancelStep.vue) as a bottom sheet. That one reads the
// account store, which the app does not have, so this is a port, not a
// reuse -- the same two questions, answered on screen before anything is
// written, and the same writes in the same order:
//
//   1. Is the fee charged? Nothing, onto the balance, or the card on file
//      (only offered when /api/stripe/card-details shows one, which it does
//      only to staff who may see it). Hidden when the clinic charges none.
//   2. What happens to the slot? Offered to the first fitting waitlist entry
//      -- named, with the deadline they get -- or left free.
//
// Then status 'cancelled', appointment.cancelled fired, the fee through
// /api/appointments/cancellation-fee, the offer through /api/waitlist/offer-next.
interface CancelAppointment {
  id: string
  patient_id: string
  clinic_id: string | null
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  ends_at: string
  patientName: string
  typeName: string | null
  practitionerName: string | null
}
const props = defineProps<{ appointment: CancelAppointment }>()
const emit = defineEmits<{ close: []; done: [message: string] }>()

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()
const { context } = usePractitionerContext()
const tz = computed(() => context.value?.timeZone ?? null)
const time = (iso: string | Date) => clinicTimeLabel(new Date(iso), tz.value)

const openedAt = new Date()
const startsAt = new Date(props.appointment.starts_at)
const startsIn = computed(() => {
  const mins = Math.round((startsAt.getTime() - openedAt.getTime()) / 60000)
  if (mins < 0) return t(`Started ${-mins} min ago`, `Empezó hace ${-mins} min`)
  if (mins < 60) return t(`Starts in ${mins} min`, `Empieza en ${mins} min`)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t(`Starts in ${hours} h ${mins % 60} min`, `Empieza en ${hours} h ${mins % 60} min`)
  const days = Math.round(hours / 24)
  return t(`Starts in ${days} ${days === 1 ? 'day' : 'days'}`, `Empieza en ${days} ${days === 1 ? 'día' : 'días'}`)
})
const deadline = offerExpiresAt(openedAt, startsAt)

interface WaitingRow {
  id: string
  appointment_type_id: string | null
  practitioner_id: string | null
}
const loading = ref(true)
const feeCents = ref(0)
const card = ref<{ brand: string; last4: string } | null>(null)
const matches = ref<{ id: string; name: string }[]>([])
const fee = ref<'none' | 'balance' | 'card'>('none')
const offer = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  if (!context.value) return
  const clinicId = props.appointment.clinic_id ?? context.value.clinicId
  const [{ data: account }, cardRes, { data: waiting }] = await Promise.all([
    supabase.from('accounts').select('cancellation_fee_cents').eq('id', context.value.accountId).maybeSingle(),
    authedFetch<{ card: { brand: string; last4: string } | null }>('/api/stripe/card-details', { method: 'POST', body: { patientId: props.appointment.patient_id } }).catch(() => ({ card: null })),
    // The whole clinic's queue without who is on it: the slot goes to whoever
    // is first, whether or not this person may see that patient.
    supabase.rpc('waitlist_waiting_in_clinic' as never, { p_clinic_id: clinicId } as never),
  ])
  feeCents.value = (account as { cancellation_fee_cents: number | null } | null)?.cancellation_fee_cents ?? 0
  card.value = cardRes?.card ?? null
  const slot = { appointmentTypeId: props.appointment.appointment_type_id, practitionerId: props.appointment.practitioner_id }
  const fitting = ((waiting as WaitingRow[] | null) ?? []).filter((w) => waitlistEntryMatches(w, slot))
  const ids = fitting.slice(0, 2).map((w) => w.id)
  const { data: named } = ids.length ? await supabase.from('waitlist_entries').select('id, patients(first_name, last_name)').in('id', ids) : { data: [] }
  const nameById = new Map(((named as unknown as { id: string; patients: { first_name: string; last_name: string | null } | null }[] | null) ?? []).map((n) => [n.id, `${n.patients?.first_name ?? ''} ${n.patients?.last_name ?? ''}`.trim()]))
  matches.value = fitting.map((w) => ({ id: w.id, name: nameById.get(w.id) || t('someone on the waitlist', 'alguien de la lista de espera') }))
  offer.value = matches.value.length > 0 && !!deadline
  loading.value = false
})

const feeText = computed(() => formatEur(feeCents.value))
const feeOptions = computed(() => {
  const opts: { key: 'none' | 'balance' | 'card'; title: string }[] = [
    { key: 'none', title: t('No charge', 'Sin cargo') },
    { key: 'balance', title: t(`Add ${feeText.value} to their balance`, `Añadir ${feeText.value} a su saldo`) },
  ]
  if (card.value) opts.push({ key: 'card', title: t(`Charge ${feeText.value} to card ···· ${card.value.last4}`, `Cobrar ${feeText.value} a la tarjeta ···· ${card.value.last4}`) })
  return opts
})
const cta = computed(() => {
  const parts = [t('Cancel visit', 'Cancelar cita')]
  if (feeCents.value > 0 && fee.value !== 'none') parts.push(t(`charge ${feeText.value}`, `cobrar ${feeText.value}`))
  if (offer.value) parts.push(t('offer slot', 'ofrecer hueco'))
  return parts.join(' · ')
})

async function confirmCancel() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.from('appointments').update({ status: 'cancelled' } as never).eq('id', props.appointment.id)
  if (e) {
    busy.value = false
    error.value = e.message
    return
  }
  authedFetch('/api/automations/fire', { method: 'POST', body: { triggerEvent: 'appointment.cancelled', patientId: props.appointment.patient_id, appointmentId: props.appointment.id } }).catch(() => {})

  let message = t('Visit cancelled.', 'Cita cancelada.')
  if (feeCents.value > 0 && fee.value !== 'none') {
    try {
      const res = await authedFetch<{ charged: boolean }>('/api/appointments/cancellation-fee', { method: 'POST', body: { appointmentId: props.appointment.id, charge: fee.value } })
      if (fee.value === 'card' && !res.charged) message = t(`Cancelled. The card was not charged; ${feeText.value} is on their balance instead.`, `Cancelada. No se pudo cobrar la tarjeta; ${feeText.value} queda en su saldo.`)
    } catch {
      message = t('Cancelled, but the fee could not be recorded.', 'Cancelada, pero no se pudo registrar el cargo.')
    }
  }
  if (offer.value) {
    const res = await authedFetch<{ offered: boolean }>('/api/waitlist/offer-next', { method: 'POST', body: { appointmentId: props.appointment.id } }).catch(() => ({ offered: false }))
    if (res.offered && matches.value[0]) message = t(`Cancelled. Slot offered to ${matches.value[0].name}.`, `Cancelada. Hueco ofrecido a ${matches.value[0].name}.`)
  }
  busy.value = false
  emit('done', message)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-ink-900/40 md:items-center md:justify-center" data-cy="cancel-visit-sheet" @click.self="emit('close')">
    <div
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Cancel the visit', 'Cancelar la cita')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ t('Cancel the visit', 'Cancelar la cita') }}</p>

      <div class="flex items-center gap-3 rounded-card border border-line bg-surface-subtle px-3.5 py-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-[15px] font-semibold text-ink-900">{{ appointment.patientName }}</p>
          <p class="text-[12.5px] text-ink-muted">
            {{ time(appointment.starts_at) }}–{{ time(appointment.ends_at) }}<template v-if="appointment.typeName"> · {{ appointment.typeName }}</template><template v-if="appointment.practitionerName"> · {{ appointment.practitionerName }}</template>
          </p>
        </div>
        <span class="shrink-0 rounded-full border border-warning-border bg-warning-bg px-2.5 py-1 text-[12px] font-semibold text-warning-text" data-cy="cancel-notice">{{ startsIn }}</span>
      </div>

      <template v-if="loading">
        <UiSkeleton class="h-12 rounded-card" />
        <UiSkeleton class="h-12 rounded-card" />
      </template>
      <template v-else>
        <fieldset v-if="feeCents > 0" class="flex flex-col gap-2" data-cy="cancel-fee">
          <legend class="mb-1.5 text-[13.5px] font-semibold text-ink-900">{{ t('Is the cancellation charged?', '¿Se cobra la cancelación?') }}</legend>
          <label
            v-for="o in feeOptions"
            :key="o.key"
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3.5 py-2.5"
            :class="fee === o.key ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'"
            :data-cy="`cancel-fee-${o.key}`"
          >
            <input v-model="fee" type="radio" name="fee" :value="o.key" class="accent-brand" />
            <span class="text-[14px] font-medium text-ink-900">{{ o.title }}</span>
          </label>
        </fieldset>

        <fieldset class="flex flex-col gap-2" data-cy="cancel-slot">
          <legend class="mb-1.5 text-[13.5px] font-semibold text-ink-900">{{ t(`The ${time(appointment.starts_at)} slot`, `El hueco de las ${time(appointment.starts_at)}`) }}</legend>
          <template v-if="matches.length">
            <label
              class="flex min-h-11 items-start gap-3 rounded-[12px] px-3.5 py-2.5"
              :class="[offer ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface', deadline ? 'cursor-pointer' : 'opacity-60']"
              data-cy="cancel-offer"
            >
              <input v-model="offer" type="radio" name="slot" :value="true" :disabled="!deadline" class="mt-1 accent-brand" />
              <span class="flex flex-col gap-0.5">
                <span class="text-[14px] font-medium text-ink-900">{{ t(`Offer it to ${matches[0].name} by WhatsApp`, `Ofrecérselo a ${matches[0].name} por WhatsApp`) }}</span>
                <span class="text-[12.5px] text-ink-muted">
                  <template v-if="deadline">
                    {{ t(`Until ${time(deadline)} to accept.`, `Tiene hasta las ${time(deadline)} para aceptar.`) }}
                    <template v-if="matches[1]">{{ t(` If not, it goes to ${matches[1].name}.`, ` Si no, pasa a ${matches[1].name}.`) }}</template>
                  </template>
                  <template v-else>{{ t('It starts too soon for anyone to take it.', 'Empieza demasiado pronto para que alguien lo aproveche.') }}</template>
                </span>
              </span>
            </label>
            <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3.5 py-2.5" :class="!offer ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'" data-cy="cancel-leave-free">
              <input v-model="offer" type="radio" name="slot" :value="false" class="accent-brand" />
              <span class="text-[14px] font-medium text-ink-900">{{ t('Leave the slot free', 'Dejar el hueco libre') }}</span>
            </label>
          </template>
          <p v-else class="text-[13px] text-ink-muted" data-cy="cancel-no-waitlist">{{ t('Nobody on the waitlist fits this slot. It stays free to book.', 'Nadie en la lista de espera encaja con este hueco. Queda libre para reservar.') }}</p>
        </fieldset>
      </template>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button type="button" class="flex h-11 items-center justify-center rounded-[12px] bg-ink-900 text-[15px] font-semibold text-surface disabled:opacity-50" :disabled="busy || loading" data-cy="confirm-cancel" @click="confirmCancel">
        {{ busy ? t('Cancelling…', 'Cancelando…') : cta }}
      </button>
      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Don’t cancel', 'No cancelar') }}</button>
    </div>
  </div>
</template>
