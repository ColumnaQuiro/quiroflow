<script setup lang="ts">
import { formatEur, formatTime, formatWeekdayDate } from '~/utils/billing'
import { offerExpiresAt, waitlistEntryMatches } from '~/utils/waitlistOffer'

// Cancelling a visit, as a step inside the appointment panel rather than a
// value in a Status dropdown. It asks the two questions a cancellation
// raises, each answered on screen before anything is written:
//
//   1. Is the fee charged? Nothing, onto the balance, or the card on file.
//      Hidden when the clinic has no cancellation fee.
//   2. What happens to the slot? Offer it to the first matching waitlist
//      entry -- named, with the deadline they will be given -- or leave it
//      free. Cancelling used to call offer-next silently every time.
//
// "Empieza en 50 min" is worked out when the step opens, never stored.

interface CancelAppointment {
  id: string
  patient_id: string
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  ends_at: string
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}
const props = defineProps<{ appointment: CancelAppointment; roomName: string }>()
const emit = defineEmits<{ back: []; close: []; done: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()
const { showToast } = useToast()
const t = useT()

// Worked out once, as the step opens: the notice and the offer deadline both
// read from this instant, so they cannot drift apart while staff decide.
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

const loading = ref(true)
const feeCents = ref(0)
const card = ref<{ brand: string; last4: string } | null>(null)
interface WaitingEntry {
  id: string
  created_at: string
  appointment_type_id: string | null
  practitioner_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}
const matches = ref<WaitingEntry[]>([])

const fee = ref<'none' | 'balance' | 'card'>('none')
const offer = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  const [{ data: account }, cardRes, { data: waiting }] = await Promise.all([
    supabase.from('accounts').select('cancellation_fee_cents').eq('id', store.accountId!).maybeSingle(),
    // Which card, if any. Only shown to staff who may see it (billing_config);
    // anyone else simply gets no card option.
    useStaffFetch<{ card: { brand: string; last4: string } | null }>('/api/stripe/card-details', { method: 'POST', body: { patientId: props.appointment.patient_id } }).catch(() => ({ card: null })),
    supabase
      .from('waitlist_entries')
      // Named foreign keys: waitlist_entries points at appointment_types and
      // team_members twice each (the preference and the offer, plus
      // created_by), and an unnamed embed is ambiguous -- PostgREST refuses
      // the whole query and the list reads as empty.
      .select(
        'id, created_at, appointment_type_id, practitioner_id, patients(first_name, last_name), appointment_types!waitlist_entries_appointment_type_id_fkey(name), team_members!waitlist_entries_practitioner_id_fkey(full_name)',
      )
      .eq('clinic_id', store.currentClinicId!)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true }),
  ])
  feeCents.value = account?.cancellation_fee_cents ?? 0
  card.value = cardRes?.card ?? null
  // The same rule, in the same order, as offerNextWaitlistEntry -- so the
  // person named here is the person the server will offer it to.
  const slot = { appointmentTypeId: props.appointment.appointment_type_id, practitionerId: props.appointment.practitioner_id }
  matches.value = ((waiting as unknown as WaitingEntry[]) ?? []).filter((w) => waitlistEntryMatches(w, slot))
  offer.value = matches.value.length > 0 && !!deadline
  loading.value = false
})

const nameOf = (p: { first_name: string; last_name: string | null } | null) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
const firstMatch = computed(() => matches.value[0] ?? null)
const secondMatch = computed(() => matches.value[1] ?? null)
const feeText = computed(() => formatEur(feeCents.value))
const practitionerFirst = computed(() => (props.appointment.team_members?.full_name ?? '').split(' ')[0])

const feeOptions = computed(() => {
  const opts: { key: 'none' | 'balance' | 'card'; title: string; sub: string }[] = [
    { key: 'none', title: t('No charge', 'Sin cargo'), sub: t('Nothing is added to their balance.', 'No se añade nada a su saldo.') },
    {
      key: 'balance',
      title: t(`Add ${feeText.value} to their balance`, `Añadir ${feeText.value} a su saldo`),
      sub: t('The clinic’s cancellation fee. Collected at the next visit or from Billing.', 'Tarifa de cancelación de la clínica. Se cobra en la próxima visita o desde Cobro.'),
    },
  ]
  if (card.value) {
    opts.push({
      key: 'card',
      title: t(`Charge ${feeText.value} to their card ···· ${card.value.last4}`, `Cobrar ${feeText.value} a su tarjeta ···· ${card.value.last4}`),
      sub: t('Charged now, with an invoice.', 'Se cobra ahora y se emite factura.'),
    })
  }
  return opts
})

const cta = computed(() => {
  const parts = [t('Cancel appointment', 'Cancelar cita')]
  if (feeCents.value > 0 && fee.value !== 'none') parts.push(t(`charge ${feeText.value}`, `cobrar ${feeText.value}`))
  if (offer.value) parts.push(t('offer slot', 'ofrecer hueco'))
  return parts.join(' · ')
})
const summary = computed(() => {
  const first = firstMatch.value ? nameOf(firstMatch.value.patients).split(' ')[0] : ''
  const feePart =
    feeCents.value > 0 && fee.value === 'balance'
      ? t(`, their balance goes up by ${feeText.value}`, `, su saldo pasa a deber ${feeText.value}`)
      : feeCents.value > 0 && fee.value === 'card'
        ? t(`, ${feeText.value} is charged to the card`, `, se cobran ${feeText.value} a la tarjeta`)
        : ''
  const slotPart = offer.value ? t(` and ${first} gets the offer now.`, ` y ${first} recibe la oferta ahora.`) : t(' and the slot stays free.', ' y el hueco queda libre.')
  return t(`The appointment is kept as cancelled in their history${feePart}${slotPart}`, `La cita queda como cancelada en su historial${feePart}${slotPart}`)
})

async function confirmCancel() {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', props.appointment.id)
  if (e) {
    busy.value = false
    error.value = e.message
    return
  }
  fire('appointment.cancelled', { patientId: props.appointment.patient_id, appointmentId: props.appointment.id })

  if (feeCents.value > 0 && fee.value !== 'none') {
    try {
      const res = await useStaffFetch<{ charged: boolean; reason?: string }>('/api/appointments/cancellation-fee', {
        method: 'POST',
        body: { appointmentId: props.appointment.id, charge: fee.value },
      })
      if (fee.value === 'card' && !res.charged) {
        showToast(t(`The card was not charged; ${feeText.value} was added to their balance instead.`, `No se pudo cobrar la tarjeta; ${feeText.value} queda en su saldo.`), 'error', 7000)
      }
    } catch {
      showToast(t('Cancelled, but the fee could not be recorded.', 'Cancelada, pero no se pudo registrar el cargo.'), 'error', 7000)
    }
  }

  // Only when asked: leaving the slot free is a real choice now.
  if (offer.value) {
    const res = await useStaffFetch<{ offered: boolean }>('/api/waitlist/offer-next', { method: 'POST', body: { appointmentId: props.appointment.id } }).catch(() => ({ offered: false }))
    if (res.offered && firstMatch.value) showToast(t(`Slot offered to ${nameOf(firstMatch.value.patients)}`, `Hueco ofrecido a ${nameOf(firstMatch.value.patients)}`))
  }
  busy.value = false
  emit('done')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-cy="cancel-sheet">
    <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
      <button type="button" :aria-label="t('Back to the appointment', 'Volver a la cita')" class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-ctl text-ink-700 hover:bg-surface-subtle" data-cy="cancel-back" @click="emit('back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2 id="cancel-title" class="flex-1 text-[18px] font-bold text-ink-900">{{ t('Cancel the appointment', 'Cancelar la cita') }}</h2>
      <button type="button" :aria-label="t('Close', 'Cerrar')" class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <div class="flex items-center gap-3 rounded-card border border-line bg-surface-subtle px-3.5 py-3">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[15px] font-bold text-ink-900">{{ nameOf(appointment.patients) }}</span>
          <span class="text-[12.5px] text-ink-muted">
            {{ formatWeekdayDate(appointment.starts_at) }} · <span class="font-mono">{{ formatTime(appointment.starts_at) }}–{{ formatTime(appointment.ends_at) }}</span>
            <template v-if="appointment.appointment_types"> · {{ appointment.appointment_types.name }}</template>
            <template v-if="appointment.team_members"> · {{ appointment.team_members.full_name }}</template> · {{ roomName }}
          </span>
        </div>
        <span class="shrink-0 rounded-full border border-warning-border bg-warning-bg px-2.5 py-1 text-[12px] font-bold text-warning-text" data-cy="cancel-notice">{{ startsIn }}</span>
      </div>

      <div v-if="loading" class="mt-5 space-y-3">
        <UiSkeleton class="h-14 rounded-card" />
        <UiSkeleton class="h-14 rounded-card" />
      </div>

      <template v-else>
        <!-- 1. The fee. Not there at all when the clinic charges none. -->
        <fieldset v-if="feeCents > 0" class="mt-5 flex flex-col gap-2" data-cy="cancel-fee">
          <legend class="mb-2 text-[13.5px] font-bold text-ink-900">{{ t('Is the cancellation charged?', '¿Se cobra la cancelación?') }}</legend>
          <label
            v-for="o in feeOptions"
            :key="o.key"
            class="flex min-h-9 touch:min-h-11 cursor-pointer items-start gap-3 rounded-[12px] px-3.5 py-3"
            :class="fee === o.key ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'"
            :data-cy="`cancel-fee-${o.key}`"
          >
            <input v-model="fee" type="radio" name="fee" :value="o.key" class="mt-1 accent-brand" />
            <span class="flex flex-col gap-0.5">
              <span class="text-[14px] font-semibold text-ink-900">{{ o.title }}</span>
              <span class="text-[12.5px] text-ink-muted">{{ o.sub }}</span>
            </span>
          </label>
        </fieldset>

        <!-- 2. The slot. -->
        <fieldset class="mt-5 flex flex-col gap-2" data-cy="cancel-slot">
          <legend class="mb-2 text-[13.5px] font-bold text-ink-900">{{ t(`The ${formatTime(appointment.starts_at)} slot`, `El hueco de las ${formatTime(appointment.starts_at)}`) }}</legend>
          <div v-if="matches.length" class="overflow-hidden rounded-card border border-line" data-cy="cancel-waitlist">
            <div class="border-b border-line-divider bg-surface-subtle px-3.5 py-2.5 text-[12.5px] text-ink-700">
              <strong>{{ t(`${matches.length} ${matches.length === 1 ? 'person' : 'people'}`, `${matches.length} ${matches.length === 1 ? 'persona' : 'personas'}`) }}</strong>
              {{ t(`on the waitlist fit (${appointment.appointment_types?.name ?? 'any type'}, with ${practitionerFirst || 'anyone'} or with anyone)`, `en la lista de espera encajan (${appointment.appointment_types?.name ?? 'cualquier tipo'}, con ${practitionerFirst || 'cualquiera'} o con cualquiera)`) }}
            </div>
            <div v-for="(w, i) in matches.slice(0, 3)" :key="w.id" class="flex items-center gap-3 border-t border-line-divider px-3.5 py-2.5 first:border-t-0" data-cy="cancel-waitlist-entry">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[12px] font-bold text-ink-500">{{ i + 1 }}</span>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[13.5px] font-semibold text-ink-900">{{ nameOf(w.patients) }}</span>
                <span class="truncate text-[12px] text-ink-muted">
                  {{ w.appointment_types?.name ?? t('Any type', 'Cualquier tipo') }} · {{ w.team_members?.full_name ?? t('any practitioner', 'cualquier profesional') }} · {{ t(`waiting since ${formatWeekdayDate(w.created_at)}`, `espera desde ${formatWeekdayDate(w.created_at)}`) }}
                </span>
              </div>
              <span v-if="i === 0" class="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-text">{{ t('first', 'la primera') }}</span>
            </div>
          </div>
          <p v-else class="text-[13px] text-ink-muted" data-cy="cancel-no-waitlist">{{ t('Nobody on the waitlist fits this slot. It stays free to book.', 'Nadie en la lista de espera encaja con este hueco. Queda libre para reservar.') }}</p>

          <template v-if="firstMatch">
            <label
              class="flex min-h-9 touch:min-h-11 items-start gap-3 rounded-[12px] px-3.5 py-3"
              :class="[offer ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface', deadline ? 'cursor-pointer' : 'cursor-not-allowed opacity-60']"
              data-cy="cancel-offer"
            >
              <input v-model="offer" type="radio" name="slot" :value="true" :disabled="!deadline" class="mt-1 accent-brand" />
              <span class="flex flex-col gap-0.5">
                <span class="text-[14px] font-semibold text-ink-900">{{ t(`Offer it to ${nameOf(firstMatch.patients)} by WhatsApp`, `Ofrecérselo a ${nameOf(firstMatch.patients)} por WhatsApp`) }}</span>
                <span v-if="deadline" class="text-[12.5px] text-ink-muted" data-cy="cancel-offer-deadline">
                  {{ t(`They have until ${formatTime(deadline)} to accept (20 min before the visit at the latest).`, `Tiene hasta las ${formatTime(deadline)} para aceptar (como tarde 20 min antes de la cita).`) }}
                  <template v-if="secondMatch">{{ t(` If not, it goes to ${nameOf(secondMatch.patients).split(' ')[0]}.`, ` Si no, pasa a ${nameOf(secondMatch.patients).split(' ')[0]}.`) }}</template>
                </span>
                <span v-else class="text-[12.5px] text-ink-muted">{{ t('It starts too soon for anyone to take it.', 'Empieza demasiado pronto para que alguien lo aproveche.') }}</span>
              </span>
            </label>
            <label class="flex min-h-9 touch:min-h-11 cursor-pointer items-start gap-3 rounded-[12px] px-3.5 py-3" :class="!offer ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'" data-cy="cancel-leave-free">
              <input v-model="offer" type="radio" name="slot" :value="false" class="mt-1 accent-brand" />
              <span class="flex flex-col gap-0.5">
                <span class="text-[14px] font-semibold text-ink-900">{{ t('Leave the slot free', 'Dejar el hueco libre') }}</span>
                <span class="text-[12.5px] text-ink-muted">{{ t('Nobody is told. It can be booked from the calendar.', 'Nadie recibe aviso. Se puede reservar desde el calendario.') }}</span>
              </span>
            </label>
          </template>
        </fieldset>
      </template>
      <p v-if="error" class="mt-3 rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text">{{ error }}</p>
    </div>

    <div class="appt-panel-footer flex shrink-0 flex-col gap-3 border-t border-line bg-surface px-5 py-3 sm:px-6">
      <span class="text-[12.5px] text-ink-muted" data-cy="cancel-summary">{{ summary }}</span>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button type="button" class="h-9 touch:h-11 rounded-ctl border border-line-control px-4 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="emit('back')">{{ t('Don’t cancel', 'No cancelar') }}</button>
        <button type="button" data-cy="confirm-cancel" :disabled="busy || loading" class="h-9 touch:h-11 rounded-ctl bg-ink-900 px-4 text-[13.5px] font-bold text-surface hover:opacity-90 disabled:opacity-50" @click="confirmCancel">{{ cta }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.appt-panel-footer {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
</style>
