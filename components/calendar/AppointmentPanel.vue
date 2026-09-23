<script setup lang="ts">
import { formatEur, formatShortDate, formatTime, formatWeekdayDate } from '~/utils/billing'
import type { BusinessHours } from '~/utils/businessHours'
import { dayKeyFor, hasBusinessHoursConfigured, practitionerWindowsForDay, windowsForDay, withinWindows } from '~/utils/businessHours'
import { effectiveDuration, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { hasArrived, isUnconfirmedStage, nextStep, STAGE_TRACK, trackIndex } from '~/utils/appointmentStage'
import type { VisitPayment } from '~/utils/visitPayment'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'
import type { StageFacts } from '~/composables/useAppointmentStage'
import type { Database } from '~/types/database.types'

type AppointmentUpdate = Database['public']['Tables']['appointments']['Update']

// An existing appointment, opened. Replaces the calendar's use of
// AppointmentModal's edit mode, whose Status dropdown made every change of
// state -- arrived, cancelled, no-show -- the same anonymous select, and
// whose form showed the time and room fields first although they are the
// thing least often changed once a visit exists.
//
// The header repeats the hover card's facts in the same order (a touch
// screen has no hover card, so this is where they are seen). Resumen then
// answers, in order: where the patient is and the one next step, the money,
// the notes, the messages already sent. The consequential actions --
// cancel, no-show, move -- sit in the footer, each its own button.

export interface PanelAppointment extends StageFacts {
  id: string
  patient_id: string
  room_id: string | null
  practitioner_id: string | null
  appointment_type_id: string | null
  starts_at: string
  ends_at: string
  status: string
  source: string
  note: string | null
  same_day_info_sent_at: string | null
  created_at: string
  patients: { first_name: string; last_name: string | null; sticky_note: string | null } | null
  appointment_types: { name: string; color: string } | null
  team_members: { full_name: string } | null
}
interface RoomOption { id: string; name: string }
interface TypeOption { id: string; name: string; duration_minutes: number; color: string }
interface MemberOption { id: string; full_name: string; business_hours?: unknown }

const props = defineProps<{
  appointment: PanelAppointment
  view: BlockView
  payment: VisitPayment
  rooms: RoomOption[]
  appointmentTypes: TypeOption[]
  teamMembers: MemberOption[]
  overrides: AppointmentTypeOverride[]
  priceCents: number
  /** The tab to open on: the flow tracker's "Cobrar" opens straight on Cobro. */
  initialTab?: 'summary' | 'billing' | 'history'
}>()
const emit = defineEmits<{ close: []; changed: []; reschedule: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()
const t = useT()
const { stageLabel, stageLine, when } = useStageLabels()
const { facts, refresh: refreshFacts } = useAppointmentFacts(() => props.appointment)
// Credit and the pack's rate: kept off the block on purpose, stated here.
const { availableCents, activePackages, refresh: refreshMoney } = usePatientFinancialSummary(() => props.appointment.patient_id)

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
// On a phone the panel is full screen and the next step lives in the footer,
// under the thumb, instead of halfway down the summary (canvas: PhoneAppointment).
const isPhone = useMediaQuery('(max-width: 639px)')

const tab = ref<'summary' | 'billing' | 'history'>(props.initialTab ?? 'summary')
// Cancelling is a step inside this panel, not a dialog on top of it.
const step = ref<'main' | 'cancel'>('main')
const busy = ref(false)
const error = ref('')

const stage = computed(() => props.view.stage)
const roomName = computed(() => props.rooms.find((r) => r.id === props.appointment.room_id)?.name ?? t('No room', 'Sin sala'))
const initials = computed(() => {
  const p = props.appointment.patients
  return `${p?.first_name?.[0] ?? ''}${p?.last_name?.[0] ?? ''}`.toUpperCase() || '?'
})
const headerSub = computed(() => {
  const f = facts.value
  if (!f) return ' '
  const parts = [
    t(`${f.visits} ${f.visits === 1 ? 'visit' : 'visits'}`, `${f.visits} ${f.visits === 1 ? 'visita' : 'visitas'}`),
    f.nextVisitAt ? t(`next ${formatShortDate(f.nextVisitAt)}`, `próxima ${formatShortDate(f.nextVisitAt)}`) : t('no next visit', 'sin próxima cita'),
  ]
  if (f.phone) parts.push(f.phone)
  return parts.join(' · ')
})
const typeColor = computed(() => props.appointment.appointment_types?.color || 'rgb(var(--color-brand))')

// --- Inline edit ("Cambiar"): time, type, room, practitioner ---------------
const editing = ref(false)
function pad(n: number) {
  return String(n).padStart(2, '0')
}
const form = reactive({ date: '', time: '', duration: 30, typeId: '', roomId: '', practitionerId: '' })
function startEdit() {
  const s = new Date(props.appointment.starts_at)
  form.date = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`
  form.time = `${pad(s.getHours())}:${pad(s.getMinutes())}`
  form.duration = Math.round((new Date(props.appointment.ends_at).getTime() - s.getTime()) / 60000)
  form.typeId = props.appointment.appointment_type_id ?? ''
  form.roomId = props.appointment.room_id ?? ''
  form.practitionerId = props.appointment.practitioner_id ?? ''
  editing.value = true
}
watch(
  () => [form.typeId, form.practitionerId],
  ([typeId, practId], old) => {
    if (!editing.value || !old || (typeId === old[0] && practId === old[1])) return
    const type = props.appointmentTypes.find((x) => x.id === typeId)
    if (type) form.duration = effectiveDuration(type.duration_minutes, typeId, practId, props.overrides)
  },
)
function outsideHours(at: Date) {
  const clinicHours = store.currentClinic?.business_hours as BusinessHours | null | undefined
  const practitionerHours = (props.teamMembers.find((m) => m.id === form.practitionerId)?.business_hours ?? null) as BusinessHours | null
  if (!hasBusinessHoursConfigured(clinicHours) && !hasBusinessHoursConfigured(practitionerHours)) return false
  return !withinWindows(at.getHours() * 60 + at.getMinutes(), practitionerWindowsForDay(windowsForDay(at, clinicHours), practitionerHours, dayKeyFor(at)))
}
async function saveEdit() {
  error.value = ''
  const startsAt = new Date(`${form.date}T${form.time}`)
  const endsAt = new Date(startsAt.getTime() + form.duration * 60000)
  if (outsideHours(startsAt) || outsideHours(new Date(endsAt.getTime() - 1))) {
    if (!confirm(t('This falls outside working hours. Save it anyway?', 'Esto queda fuera del horario de atención. ¿Guardarlo de todos modos?'))) return
  }
  // Instants, not strings: Postgres and toISOString() spell the same moment
  // differently, and comparing the strings marked every edit as a move.
  const same = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()
  const timeChanged = !same(startsAt.toISOString(), props.appointment.starts_at) || !same(endsAt.toISOString(), props.appointment.ends_at)
  busy.value = true
  const { error: e } = await supabase
    .from('appointments')
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      appointment_type_id: form.typeId || null,
      room_id: form.roomId || null,
      practitioner_id: form.practitionerId || null,
      ...(timeChanged ? { rescheduled: true } : {}),
    })
    .eq('id', props.appointment.id)
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  if (timeChanged) fire('appointment.rescheduled', { patientId: props.appointment.patient_id, appointmentId: props.appointment.id })
  editing.value = false
  emit('changed')
}

// --- Stage track and the one next step --------------------------------------
const trackSteps = computed(() => {
  const a = props.appointment
  const idx = Math.max(0, trackIndex(stage.value))
  const unconfirmed = isUnconfirmedStage(stage.value)
  const labels = [unconfirmed ? stageLabel(stage.value) : t('Confirmed', 'Confirmada'), t('Arrived', 'Llegó'), t('In session', 'En consulta'), t('To pay', 'Por cobrar'), t('Done', 'Hecha')]
  const times = [null, a.checked_in_at, a.flow_with_practitioner_at, a.flow_checkout_at, null]
  return STAGE_TRACK.map((key, i) => ({
    key,
    label: labels[i],
    when: times[i] ? formatTime(times[i]!) : '',
    state: unconfirmed && i === 0 ? 'waiting' : i < idx ? 'done' : i === idx ? 'current' : 'next',
  }))
})
const onTrack = computed(() => stage.value !== 'noshow' && stage.value !== 'cancelled')
const next = computed(() => nextStep(stage.value))
const nextLabel = computed(() => {
  switch (next.value) {
    case 'checkin':
      return t('Check in', 'Registrar llegada')
    case 'withp':
      return t('Into session', 'Pasa a consulta')
    case 'checkout':
      return t('To checkout', 'Pasar a cobro')
    case 'charge':
      return t('Charge', 'Cobrar')
    default:
      return ''
  }
})
// Undo the last flow step, for the tap that landed on the wrong patient.
const undoable = computed(() => {
  if (props.appointment.status !== 'booked') return null
  if (stage.value === 'checkout') return { field: 'flow_checkout_at' as const, label: t('Undo checkout', 'Deshacer paso a cobro') }
  if (stage.value === 'withp') return { field: 'flow_with_practitioner_at' as const, label: t('Undo session', 'Deshacer consulta') }
  if (stage.value === 'arrived') return { field: 'checked_in_at' as const, label: t('Undo arrival', 'Deshacer llegada') }
  return null
})

async function update(values: AppointmentUpdate) {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.from('appointments').update(values).eq('id', props.appointment.id)
  busy.value = false
  if (e) {
    error.value = e.message
    return false
  }
  emit('changed')
  return true
}
async function advance() {
  const now = new Date().toISOString()
  switch (next.value) {
    case 'checkin':
      if (await update({ checked_in_at: now })) fire('appointment.checked_in', { patientId: props.appointment.patient_id, appointmentId: props.appointment.id })
      return
    case 'withp':
      await update({ flow_with_practitioner_at: now })
      return
    case 'checkout':
      await update({ flow_checkout_at: now })
      return
    case 'charge':
      tab.value = 'billing'
  }
}
function undo() {
  if (undoable.value) update({ [undoable.value.field]: null })
}
// Confirmed by phone or at the desk, rather than by replying to WhatsApp.
function markConfirmed() {
  update({ confirmation_status: 'confirmed' })
}
// Out of the room with nothing to charge (a bono visit, a courtesy): done.
async function markDone() {
  if (await update({ status: 'completed' })) fire('appointment.completed', { patientId: props.appointment.patient_id, appointmentId: props.appointment.id })
}

// --- Money --------------------------------------------------------------------
const methodLabel = (m: string) => ({ cash: t('cash', 'efectivo'), card: t('card', 'tarjeta'), transfer: t('transfer', 'transferencia'), bizum: 'Bizum' })[m] ?? m
const visitMoney = computed<{ title: string; sub: string; right?: string; tone: 'ok' | 'due' | 'muted' }>(() => {
  const p = props.payment
  const bono = props.view.bono
  if (bono) {
    // The rate the session is charged at is the bono's, not the type's --
    // the same rounding AppointmentBillingTab bills it with.
    const pack = activePackages.value.find((x) => x.package_name === bono.packageName) ?? activePackages.value[0]
    const rate = !bono.drawn && pack?.sessions_total ? formatEur(Math.round(pack.price_cents / pack.sessions_total)) : null
    return {
      title: bono.packageName,
      sub: bono.drawn ? t('session used', 'sesión descontada') : rate ? t(`uses 1 session at ${rate}`, `se descuenta 1 sesión a ${rate}`) : t('uses 1 session', 'se descuenta 1 sesión'),
      right: t(`${bono.remaining} of ${bono.total} left`, `quedan ${bono.remaining} de ${bono.total}`),
      tone: 'ok',
    }
  }
  switch (p.kind) {
    case 'settled':
      return { title: t('Paid', 'Cobrada'), sub: [p.methods.map(methodLabel).join(' + '), p.facturaNumber ?? p.invoiceNumber].join(' · '), tone: 'ok' }
    case 'unpaid':
      return { title: t(`Not paid · ${formatEur(p.totalCents)}`, `Sin cobrar · ${formatEur(p.totalCents)}`), sub: p.invoiceNumber, tone: 'due' }
    case 'void':
      return { title: t('Charge voided', 'Cargo anulado'), sub: p.invoiceNumber, tone: 'muted' }
    default:
      return { title: t('Not charged yet', 'Sin cobrar todavía'), sub: props.priceCents ? t(`${formatEur(props.priceCents)} at checkout`, `${formatEur(props.priceCents)} al cobrar`) : '', tone: 'muted' }
  }
})
const unpaidList = computed(() =>
  (facts.value?.unpaid ?? []).map((u) => `${u.typeName ? `${u.typeName} ` : ''}${formatShortDate(u.at)}`).join(' · '),
)

// --- Notes ----------------------------------------------------------------------
const stickyNote = ref(props.appointment.patients?.sticky_note ?? '')
const visitNote = ref(props.appointment.note ?? '')
watch(
  () => props.appointment.id,
  () => {
    stickyNote.value = props.appointment.patients?.sticky_note ?? ''
    visitNote.value = props.appointment.note ?? ''
  },
)
const savedNote = ref<'sticky' | 'visit' | null>(null)
async function saveSticky() {
  if ((props.appointment.patients?.sticky_note ?? '') === stickyNote.value) return
  await supabase.from('patients').update({ sticky_note: stickyNote.value.trim() || null }).eq('id', props.appointment.patient_id)
  savedNote.value = 'sticky'
  emit('changed')
}
async function saveVisitNote() {
  if ((props.appointment.note ?? '') === visitNote.value) return
  await supabase.from('appointments').update({ note: visitNote.value.trim() || null }).eq('id', props.appointment.id)
  savedNote.value = 'visit'
  emit('changed')
}

// --- Messages sent, and the history tab ------------------------------------------
const messages = computed(() =>
  [
    { at: props.appointment.confirmation_sent_at, label: t('Confirmation', 'Confirmación') },
    { at: props.appointment.reminder_sent_at, label: t('Reminder', 'Recordatorio') },
    { at: props.appointment.same_day_info_sent_at, label: t('Same-day info', 'Info del día') },
  ].filter((m): m is { at: string; label: string } => !!m.at),
)
const history = computed(() => {
  const a = props.appointment
  const events: { at: string; text: string }[] = [{ at: a.created_at, text: a.source === 'online' ? t('Booked online', 'Reservada online') : t('Booked', 'Reservada') }]
  for (const m of messages.value) events.push({ at: m.at, text: t(`${m.label} sent`, `${m.label} enviada`) })
  for (const r of facts.value?.reschedules ?? [])
    events.push({ at: r.at, text: t(`Moved from ${formatWeekdayDate(r.from)} ${formatTime(r.from)} to ${formatWeekdayDate(r.to)} ${formatTime(r.to)}`, `Movida del ${formatWeekdayDate(r.from)} ${formatTime(r.from)} al ${formatWeekdayDate(r.to)} ${formatTime(r.to)}`) })
  if (a.checked_in_at) events.push({ at: a.checked_in_at, text: t('Arrived', 'Llegó') })
  if (a.flow_with_practitioner_at) events.push({ at: a.flow_with_practitioner_at, text: t('Into session', 'Pasó a consulta') })
  if (a.flow_checkout_at) events.push({ at: a.flow_checkout_at, text: t('To checkout', 'Pasó a cobro') })
  return events.sort((x, y) => y.at.localeCompare(x.at))
})

// --- Footer actions ---------------------------------------------------------------
// The missed-appointment fee from Settings > Scheduling Policies, as before:
// the configured fee, confirmed once. (Cancelling asks about its own fee in
// the cancel step.)
async function maybeApplyStatusFee(kind: 'no_show') {
  const column = 'missed_appointment_fee_cents'
  const { data: account } = await supabase.from('accounts').select(column).eq('id', store.accountId!).maybeSingle()
  const feeCents = (account as Record<string, number | null> | null)?.[column]
  if (!feeCents) return
  const question = t(`Add the ${formatEur(feeCents)} missed-appointment fee to this patient's balance?`, `¿Añadir el cargo por no presentarse de ${formatEur(feeCents)} a su saldo?`)
  if (!confirm(question)) return
  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
  if (!invoiceNumber) return
  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: store.accountId!, patient_id: props.appointment.patient_id, invoice_number: invoiceNumber, status: 'unpaid', total_cents: feeCents })
    .select('id')
    .single()
  if (!invoice) return
  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: invoice.id,
    description: 'Missed appointment fee',
    quantity: 1,
    price_cents: feeCents,
  })
}
function cancelAppointment() {
  step.value = 'cancel'
}
function onCancelled() {
  emit('changed')
  emit('close')
}
async function markNoShow() {
  if (!(await update({ status: 'no_show' }))) return
  fire('appointment.no_show', { patientId: props.appointment.patient_id, appointmentId: props.appointment.id })
  await maybeApplyStatusFee('no_show')
}
async function remove() {
  if (!confirm(t('Delete this appointment?', '¿Eliminar esta cita?'))) return
  // Soft delete, so "Hide deleted" has a row to hide.
  if (await update({ deleted_at: new Date().toISOString() })) emit('close')
}

function onBillingCompleted() {
  refreshFacts()
  refreshMoney()
  emit('changed')
}
const canAct = computed(() => props.appointment.status === 'booked')
</script>

<template>
  <div class="fixed inset-0 z-40 bg-ink-900/20" aria-hidden="true" @click="emit('close')" />
  <div
    ref="panel"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="step === 'cancel' ? 'cancel-title' : 'appt-name'"
    data-cy="appt-sheet"
    tabindex="-1"
    class="appt-panel fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-popover outline-none sm:w-[560px]"
  >
    <CalendarCancelStep v-if="step === 'cancel'" :appointment="appointment" :room-name="roomName" @back="step = 'main'" @close="emit('close')" @done="onCancelled" />

    <template v-else>
    <!-- Header: the hover card's facts, in the same order. -->
    <div class="shrink-0 border-b border-line px-5 pt-3 sm:px-6">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Appointment', 'Cita') }}</span>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[15px] font-bold text-brand-text">{{ initials }}</span>
        <div class="flex min-w-0 flex-1 flex-col">
          <h2 id="appt-name" class="truncate text-[20px] font-bold text-ink-900">{{ view.name }}</h2>
          <span class="truncate text-[12.5px] text-ink-muted" data-cy="appt-sheet-facts">{{ headerSub }}</span>
        </div>
        <NuxtLink :to="`/patients/${appointment.patient_id}`" class="flex h-11 shrink-0 items-center gap-1 rounded-ctl px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-tint">
          {{ t('Chart', 'Ficha') }}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
        </NuxtLink>
      </div>

      <div v-if="!editing" class="mt-3 flex items-center gap-3 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
        <span class="h-2.5 w-2.5 shrink-0 rounded-[3px]" :style="{ background: typeColor }" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col text-[13px]">
          <span class="font-semibold text-ink-900" data-cy="appt-sheet-when">{{ formatWeekdayDate(appointment.starts_at) }} · <span class="font-mono font-medium">{{ formatTime(appointment.starts_at) }}–{{ formatTime(appointment.ends_at) }}</span></span>
          <span class="truncate text-ink-muted">{{ [appointment.appointment_types?.name, appointment.team_members?.full_name, roomName].filter(Boolean).join(' · ') }}</span>
        </div>
        <button v-if="canAct" type="button" data-cy="appt-edit" class="h-11 shrink-0 rounded-ctl px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-tint" @click="startEdit">{{ t('Change', 'Cambiar') }}</button>
      </div>
      <form v-else class="mt-3 grid grid-cols-2 gap-2.5 rounded-ctl border border-line bg-surface-subtle p-3 text-[12.5px]" data-cy="appt-edit-form" @submit.prevent="saveEdit">
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Date', 'Fecha') }}<input v-model="form.date" type="date" required class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700" /></label>
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Time', 'Hora') }}<input v-model="form.time" type="time" required class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700" /></label>
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Type', 'Tipo') }}
          <select v-model="form.typeId" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
            <option value="">{{ t('No type', 'Sin tipo') }}</option>
            <option v-for="ty in appointmentTypes" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Minutes', 'Minutos') }}<input v-model.number="form.duration" type="number" min="5" step="5" required class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700" /></label>
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Room', 'Sala') }}
          <select v-model="form.roomId" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
            <option value="">{{ t('No room', 'Sin sala') }}</option>
            <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 font-medium text-ink-600">{{ t('Practitioner', 'Profesional') }}
          <select v-model="form.practitionerId" class="h-11 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
            <option value="">{{ t('No practitioner', 'Sin profesional') }}</option>
            <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
        </label>
        <div class="col-span-2 flex justify-end gap-2">
          <UiBtn variant="secondary" type="button" @click="editing = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn variant="primary" type="submit" :disabled="busy" data-cy="appt-edit-save">{{ t('Save', 'Guardar') }}</UiBtn>
        </div>
      </form>

      <div role="tablist" class="mt-3 flex gap-1">
        <button
          v-for="k in (['summary', 'billing', 'history'] as const)"
          :key="k"
          type="button"
          role="tab"
          :aria-selected="tab === k"
          :data-cy="`appt-tab-${k}`"
          class="-mb-px flex h-11 items-center gap-1.5 border-b-2 px-3 text-[13.5px] font-semibold"
          :class="tab === k ? 'border-brand text-brand-text' : 'border-transparent text-ink-muted hover:text-ink-700'"
          @click="tab = k"
        >
          {{ k === 'summary' ? t('Summary', 'Resumen') : k === 'billing' ? t('Billing', 'Cobro') : t('History', 'Historial') }}
          <span v-if="k === 'billing' && (payment.kind === 'unpaid' || view.owesCents > 0)" class="h-1.5 w-1.5 rounded-full bg-danger-text" aria-hidden="true" />
          <span v-if="k === 'history'" class="rounded-full bg-chip-bg px-1.5 text-[11px] text-chip-text">{{ history.length }}</span>
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <p v-if="error" class="mb-3 rounded-ctl bg-danger-bg px-3 py-2 text-[13px] text-danger-text">{{ error }}</p>

      <div v-if="tab === 'summary'" class="flex flex-col gap-6">
        <!-- Where it stands: status + confirmation + flow, one track. -->
        <section>
          <h3 class="mb-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Where it stands', 'Dónde está') }}</h3>
          <ol v-if="onTrack" class="grid grid-cols-5 gap-1.5" :aria-label="t('Appointment stage', 'Estado de la cita')" data-cy="stage-track">
            <li v-for="s in trackSteps" :key="s.key" class="flex min-w-0 flex-col gap-1" :data-state="s.state" :aria-current="s.state === 'current' ? 'step' : undefined">
              <span class="h-1.5 rounded-[3px]" :class="s.state === 'done' || s.state === 'current' ? 'bg-success-accent' : s.state === 'waiting' ? 'bg-warning-accent' : 'bg-line'" />
              <span class="text-[11.5px] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[12.5px]" :class="s.state === 'next' ? 'text-ink-faint' : s.state === 'current' ? 'font-bold text-success-text' : s.state === 'waiting' ? 'font-bold text-warning-text' : 'text-ink-700'">{{ s.label }}</span>
              <span class="font-mono text-[11px] text-ink-muted">{{ s.when || ' ' }}</span>
            </li>
          </ol>
          <p v-else class="text-[14px] font-semibold text-ink-700" data-cy="stage-off-track">{{ stageLine(appointment, stage).title }}</p>
          <p v-if="onTrack && stageLine(appointment, stage).sub" class="mt-2 text-[12.5px] text-ink-muted">{{ stageLine(appointment, stage).title }} · {{ stageLine(appointment, stage).sub }}</p>

          <div v-if="next || undoable || isUnconfirmedStage(stage)" class="mt-3 flex flex-wrap items-center gap-2">
            <button v-if="next && !isPhone" type="button" data-cy="advance-stage" :data-next="next" :disabled="busy" class="flex h-11 items-center gap-2 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover disabled:opacity-60" @click="advance">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              {{ nextLabel }}
            </button>
            <button v-if="isUnconfirmedStage(stage)" type="button" data-cy="mark-confirmed" :disabled="busy" class="h-11 rounded-ctl border border-line-control px-3.5 text-[13px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="markConfirmed">{{ t('Mark confirmed', 'Marcar confirmada') }}</button>
            <button v-if="stage === 'checkout'" type="button" data-cy="mark-done" :disabled="busy" class="h-11 rounded-ctl border border-line-control px-3.5 text-[13px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="markDone">{{ t('Done, nothing to charge', 'Hecha, sin cobro') }}</button>
            <button v-if="undoable" type="button" data-cy="undo-stage" :disabled="busy" class="h-11 rounded-ctl px-3 text-[13px] font-semibold text-ink-muted hover:bg-surface-subtle" @click="undo">{{ undoable.label }}</button>
          </div>
        </section>

        <!-- Money: this visit, and the patient's balance beside it. -->
        <section>
          <h3 class="mb-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Money', 'Dinero') }}</h3>
          <div class="overflow-hidden rounded-card border border-line">
            <div class="flex items-center gap-3 px-3.5 py-3" data-cy="visit-money">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-[12px] text-ink-muted">{{ t('This visit', 'Esta visita') }}</span>
                <span class="text-[14px] font-semibold" :class="visitMoney.tone === 'due' ? 'text-danger-text' : 'text-ink-900'">{{ visitMoney.title }}<span v-if="visitMoney.sub" class="font-normal text-ink-muted"> · {{ visitMoney.sub }}</span></span>
              </div>
              <span v-if="visitMoney.right" class="shrink-0 rounded-[6px] border border-brand-tintBorder bg-brand-tint px-2 py-1 text-[12px] font-semibold text-brand-text">{{ visitMoney.right }}</span>
            </div>
            <div class="flex items-center gap-3 border-t px-3.5 py-3" :class="view.owesCents > 0 ? 'border-danger-border bg-danger-bg' : 'border-line-divider'" data-cy="patient-balance">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-[12px] text-ink-muted">{{ t('Patient balance', 'Saldo del paciente') }}</span>
                <span v-if="view.owesCents > 0" class="text-[15px] font-bold text-danger-text">{{ t(`Owes ${formatEur(view.owesCents)}`, `Debe ${formatEur(view.owesCents)}`) }}</span>
                <!-- Both can be true: the balance is every charge against every
                     payment, while "available" is loose credit plus unused bono
                     value. When they disagree, say both rather than pick one. -->
                <span v-if="view.owesCents > 0 && availableCents > 0" class="text-[12.5px] font-semibold text-success-text">{{ t(`${formatEur(availableCents)} available`, `${formatEur(availableCents)} disponible`) }}</span>
                <span v-else-if="availableCents > 0" class="text-[14px] font-semibold text-success-text">{{ t(`${formatEur(availableCents)} available`, `${formatEur(availableCents)} disponible`) }}</span>
                <span v-else class="text-[14px] font-semibold text-ink-700">{{ t('Nothing owed', 'Sin saldo pendiente') }}</span>
                <span v-if="view.owesCents > 0 && unpaidList" class="truncate text-[12px] text-ink-500">{{ t(`${unpaidList}, unpaid`, `${unpaidList}, sin cobrar`) }}</span>
              </div>
              <NuxtLink v-if="view.owesCents > 0" :to="`/patients/${appointment.patient_id}?tab=money`" data-cy="collect-balance" class="flex h-11 shrink-0 items-center rounded-ctl bg-danger-text px-3.5 text-[13.5px] font-bold text-surface hover:opacity-90">
                {{ t(`Collect ${formatEur(view.owesCents)}`, `Cobrar ${formatEur(view.owesCents)}`) }}
              </NuxtLink>
            </div>
          </div>
        </section>

        <!-- Notes: editing lives here, not in the hover card. -->
        <section class="flex flex-col gap-3">
          <h3 class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Notes', 'Notas') }}</h3>
          <label class="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-600">
            <span>{{ t('Patient note · shows on every appointment', 'Nota del paciente · se ve en todas sus citas') }} <span v-if="savedNote === 'sticky'" class="font-normal text-success-text">· {{ t('saved', 'guardada') }}</span></span>
            <textarea v-model="stickyNote" rows="2" data-cy="sticky-note" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" @blur="saveSticky" @input="savedNote = null" />
          </label>
          <label class="flex flex-col gap-1.5 text-[12.5px] font-medium text-ink-600">
            <span>{{ t('Note for this visit', 'Nota de esta visita') }} <span v-if="savedNote === 'visit'" class="font-normal text-success-text">· {{ t('saved', 'guardada') }}</span></span>
            <textarea v-model="visitNote" rows="2" data-cy="visit-note" :placeholder="t('Quick note for this visit…', 'Nota rápida para esta visita…')" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none" @blur="saveVisitNote" @input="savedNote = null" />
          </label>
        </section>

        <!-- Messages: facts the row already has. -->
        <section>
          <h3 class="mb-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-ink-muted">{{ t('Messages sent', 'Avisos enviados') }}</h3>
          <div v-if="messages.length" class="flex flex-wrap gap-2" data-cy="messages-sent">
            <span v-for="m in messages" :key="m.label" class="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-subtle px-3 py-1.5 text-[12.5px] text-ink-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="text-success-accent" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              {{ m.label }} · {{ when(m.at) }}
            </span>
          </div>
          <p v-else class="text-[13px] text-ink-muted">{{ t('None yet.', 'Ninguno todavía.') }}</p>
        </section>

        <button type="button" class="self-start text-[12.5px] font-medium text-ink-muted underline-offset-2 hover:underline" @click="remove">{{ t('Delete appointment', 'Eliminar cita') }}</button>
      </div>

      <div v-else-if="tab === 'billing'">
        <CalendarAppointmentBillingTab
          :appointment-id="appointment.id"
          :patient-id="appointment.patient_id"
          :appointment-type-name="appointment.appointment_types?.name"
          :appointment-type-price-cents="priceCents"
          @completed="onBillingCompleted"
        />
      </div>

      <ol v-else class="flex flex-col" data-cy="appt-history">
        <li v-for="(e, i) in history" :key="i" class="flex gap-3 border-b border-line-divider py-2.5 text-[13px] last:border-b-0">
          <span class="w-[118px] shrink-0 font-mono text-[12px] text-ink-muted">{{ formatShortDate(e.at) }} {{ formatTime(e.at) }}</span>
          <span class="text-ink-700">{{ e.text }}</span>
        </li>
      </ol>
    </div>

    <!-- Footer: the consequential actions, each its own button. -->
    <div class="appt-panel-footer flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3 sm:px-6">
      <button v-if="next && isPhone" type="button" data-cy="advance-stage" :data-next="next" :disabled="busy" class="flex h-12 w-full items-center justify-center gap-2 rounded-ctl bg-brand text-[15px] font-bold text-surface disabled:opacity-60" @click="advance">
        {{ nextLabel }}
      </button>
      <template v-if="canAct">
        <button type="button" data-cy="cancel-appointment" :disabled="busy" class="h-11 rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="cancelAppointment">{{ t('Cancel appointment…', 'Cancelar cita…') }}</button>
        <button
          type="button"
          data-cy="mark-no-show"
          :disabled="busy || hasArrived(stage)"
          :title="hasArrived(stage) ? t('Already arrived', 'Ya ha llegado') : undefined"
          class="h-11 rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
          @click="markNoShow"
        >
          {{ t('No-show', 'No vino') }}
        </button>
        <span class="grow" />
        <button type="button" data-cy="move-appointment" :disabled="busy" class="flex h-11 items-center gap-1.5 rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="emit('reschedule')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14l-4-4M20 16H6l4 4" /></svg>
          {{ t('Move…', 'Mover…') }}
        </button>
      </template>
      <p v-else class="text-[13px] text-ink-muted">{{ stageLabel(stage) }}</p>
    </div>
    </template>
  </div>
</template>

<style scoped>
.appt-panel {
  animation: panel-in 160ms ease-out;
}
@keyframes panel-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
/* Clear the home indicator on a phone, where the footer sits at the edge. */
.appt-panel-footer {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
</style>
