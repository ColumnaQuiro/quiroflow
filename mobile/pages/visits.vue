<script lang="ts">
// Across mounts of this screen within one app run.
let shownBefore = false
</script>

<script setup lang="ts">
import { formatEur } from '../../utils/billing'

// "Plan": the patient's visits and what they are part of, in the order they
// are asked about -- the next visit, the care plan, what is left on the bono
// and what is owed, the visits after that, the ones before, and the
// facturas. It took over from the Citas and Pagos tabs (the full invoice
// list is still /billing, opened from here). "Plan", not "Tratamiento": a
// chiropractor in Spain may not call their care a treatment.
//
// What the patient may do follows the clinic: changing and cancelling only
// when it lets patients (settings.rescheduleEnabled / cancelEnabled) and the
// visit is far enough off (canChange); paying only when it takes payments
// online (usePatientPay). Otherwise the screen says to contact the clinic.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const { settings } = usePatientAppInfo()
const { patient, loading: identityLoading } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')

const { upcoming, past, loading, loadError, reload, busyId, canChange, cancel, confirmAttendance, confirmingId } = usePatientAppointments(
  () => patientId.value,
  () => settings.value,
)
const next = computed(() => upcoming.value[0] ?? null)
const later = computed(() => upcoming.value.slice(1))

const { loading: moneyLoading, outstandingCents, creditLedgerCents, activePackages, activeMembership, refresh: refreshMoney } = usePatientFinancialSummary(() => patientId.value)
const { invoices, loading: invoicesLoading, loadError: invoicesError, reload: reloadInvoices, busyId: downloadingId, download } = usePatientInvoices(() => patientId.value)
const { enabled: canPayOnline, payingId, error: payError, pay } = usePatientPay(() => {
  reloadInvoices()
  refreshMoney()
})

// Fresh figures each time this screen is shown again and when the app comes
// back to the front, as Inicio does: a debt paid at the desk otherwise stayed
// on screen until the app was force-quit.
onMounted(() => {
  if (shownBefore) refreshMoney()
  shownBefore = true
})
function onVisible() {
  if (document.visibilityState === 'visible') refreshMoney()
}
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

// "Pagar": straight to the one invoice when there is one, else the list.
const unpaid = computed(() => invoices.value.filter((i) => i.status === 'unpaid'))
function payOutstanding() {
  if (unpaid.value.length === 1) pay(unpaid.value[0]!.id)
  else navigateTo('/billing')
}
const recentInvoices = computed(() => invoices.value.slice(0, 3))

const showAllPast = ref(false)
const PAST_PREVIEW = 5
const visiblePast = computed(() => (showAllPast.value ? past.value : past.value.slice(0, PAST_PREVIEW)))

// Rescheduling needs a slot picker; /book already is one.
function goReschedule(appointmentId: string) {
  navigateTo(`/book?reschedule=${appointmentId}`)
}

// Read at the clinic's hour (the zone comes with each visit), not the phone's.
type When = { starts_at: string; clinic_id?: string | null }
const { zoneOf: clinicZone } = usePatientAppInfo()
const zoneOf = (a: When) => clinicZone(a.clinic_id)
function formatWhen(a: When) {
  return new Date(a.starts_at).toLocaleString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zoneOf(a) })
}
function weekday(a: When) {
  return new Date(a.starts_at).toLocaleDateString(locale.value, { weekday: 'short', timeZone: zoneOf(a) }).replace(/\./g, '')
}
function dayNumber(a: When) {
  return new Date(a.starts_at).toLocaleDateString(locale.value, { day: 'numeric', timeZone: zoneOf(a) })
}
function monthShort(a: When) {
  return new Date(a.starts_at).toLocaleDateString(locale.value, { month: 'short', timeZone: zoneOf(a) }).replace(/\./g, '')
}
function timeOnly(a: When) {
  return new Date(a.starts_at).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: zoneOf(a) })
}
function eur(cents: number) {
  return formatEur(cents)
}
</script>

<template>
  <PatientScreen :title="t('Plan', 'Plan')">
    <template v-if="!identityLoading && patient">
      <!-- The next visit, with everything that can be done about it -->
      <section class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-plan-next">
        <div class="flex items-center gap-2">
          <p class="flex-1 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Next visit', 'Próxima cita') }}</p>
          <NuxtLink v-if="settings.bookingEnabled" to="/book" class="text-[12.5px] font-medium text-brand-text">{{ t('+ Book', '+ Reservar') }}</NuxtLink>
        </div>
        <div v-if="loading" class="mt-2"><UiSkeleton class="h-14 w-full rounded-ctl" /></div>
        <PatientLoadError v-else-if="loadError" @retry="reload" />
        <template v-else-if="next">
          <div class="mt-2.5 flex items-center gap-3">
            <span class="flex w-14 shrink-0 flex-col items-center rounded-ctl border border-brand-tintBorder bg-brand-tint py-1.5 leading-tight">
              <span class="text-[10.5px] font-[640] uppercase text-brand-text">{{ weekday(next) }}</span>
              <span class="text-[20px] font-[640] text-ink-900">{{ dayNumber(next) }}</span>
              <span class="text-[11px] text-brand-text">{{ monthShort(next) }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[15px] font-semibold text-ink-900">{{ timeOnly(next) }} &middot; {{ next.appointment_types?.name ?? t('Appointment', 'Cita') }}</p>
              <p v-if="next.team_members?.full_name" class="mt-0.5 text-[12.5px] text-ink-muted">{{ next.team_members.full_name }}</p>
            </div>
          </div>
          <PatientCheckIn class="mt-3" :appt="next" />
          <PatientConfirmVisit class="mt-3" :appt="next" :busy="confirmingId === next.id" @confirm="confirmAttendance" />
          <div v-if="canChange(next) && (settings.rescheduleEnabled || settings.cancelEnabled)" class="mt-3 flex gap-2">
            <button v-if="settings.rescheduleEnabled" type="button" class="h-11 flex-1 rounded-ctl border border-line-control text-[13.5px] font-semibold text-ink-700 disabled:opacity-60" :disabled="busyId === next.id" data-cy="patient-plan-reschedule" @click="goReschedule(next.id)">
              {{ t('Reschedule', 'Cambiar') }}
            </button>
            <button v-if="settings.cancelEnabled" type="button" class="h-11 flex-1 rounded-ctl border border-danger-border text-[13.5px] font-semibold text-danger-text disabled:opacity-60" :disabled="busyId === next.id" data-cy="patient-plan-cancel" @click="cancel(next, formatWhen(next))">
              {{ busyId === next.id ? t('Cancelling…', 'Cancelando…') : t('Cancel', 'Cancelar') }}
            </button>
          </div>
          <p v-else-if="next.status === 'booked'" class="mt-3 text-[12.5px] text-ink-muted">
            {{ t('To change or cancel this visit, message or call the clinic.', 'Para cambiar o cancelar esta cita, escribe o llama a la clínica.') }}
          </p>
          <PatientNextVisitActions class="mt-3" :appointment-id="next.id" :clinic-id="next.clinic_id" />
        </template>
        <p v-else class="mt-2 text-[14px] text-ink-muted">{{ t('Nothing booked yet.', 'No tienes ninguna cita reservada.') }}</p>
      </section>

      <!-- The care plan: how far along, and its booked dates -->
      <PatientCarePlanCard
        class="mt-3"
        :patient-id="patientId"
        messages-to="/messages"
        :reschedule-to="(id) => `/book?reschedule=${id}`"
        :book-to="settings.bookingEnabled ? '/book' : null"
      />

      <!-- Sessions left, credit, and what is owed -->
      <section class="mt-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-plan-money">
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Sessions and balance', 'Sesiones y saldo') }}</p>
        <div v-if="moneyLoading" class="mt-2"><UiSkeleton class="h-10 w-full rounded-ctl" /></div>
        <template v-else>
          <div v-if="activePackages.length > 0" class="mt-3 space-y-4">
            <PatientBonoProgress
              v-for="pkg in activePackages"
              :key="pkg.id"
              :name="pkg.package_name"
              :sessions-total="pkg.sessions_total"
              :sessions-used="pkg.sessions_used"
              :shared-by="pkg.shared ? pkg.ownerName : undefined"
              :wallet-id="pkg.shared ? undefined : pkg.id"
            />
          </div>
          <p v-else class="mt-2 text-[13px] text-ink-faint">{{ t('You have no active package.', 'No tienes ningún bono activo.') }}</p>
          <p v-if="activeMembership" class="mt-3 text-[12.5px] text-ink-muted">
            {{ t(`${activeMembership.membership_name} membership active`, `Membresía ${activeMembership.membership_name} activa`) }}
          </p>
          <div class="mt-3 flex items-center border-t border-line-divider pt-3">
            <span class="flex-1 text-[14px] text-ink-700">{{ t('Credit in your favour', 'Saldo a tu favor') }}</span>
            <span class="text-[16px] font-[640] text-ink-900" data-cy="patient-plan-credit">{{ eur(creditLedgerCents) }}</span>
          </div>
          <template v-if="outstandingCents > 0">
            <div class="mt-2 flex items-center">
              <span class="flex-1 text-[14px] text-danger-text">{{ t('Waiting to be paid', 'Pendiente de pago') }}</span>
              <span class="text-[16px] font-[640] text-danger-text" data-cy="patient-plan-owed">{{ eur(outstandingCents) }}</span>
            </div>
            <button
              v-if="canPayOnline && unpaid.length > 0"
              type="button"
              class="mt-3 h-11 w-full rounded-ctl bg-danger-text text-[13.5px] font-semibold text-danger-on disabled:opacity-60"
              :disabled="payingId !== null"
              data-cy="patient-plan-pay"
              @click="payOutstanding"
            >
              {{ payingId ? t('Opening…', 'Abriendo…') : t(`Pay ${eur(outstandingCents)}`, `Pagar ${eur(outstandingCents)}`) }}
            </button>
            <p v-else class="mt-2 text-[12.5px] text-ink-muted">{{ t('You can pay it at your next visit.', 'Lo puedes pagar en tu próxima visita.') }}</p>
          </template>
          <p v-if="payError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ payError }}</p>
        </template>
      </section>

      <!-- The visits after the next one -->
      <PatientCard v-if="later.length > 0" class="mt-3" :title="t('After that', 'Después')" flush>
        <ul class="divide-y divide-line-divider">
          <li v-for="appt in later" :key="appt.id" class="px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="w-16 shrink-0 text-[13px] font-semibold text-ink-900">{{ weekday(appt) }} {{ dayNumber(appt) }}</span>
              <span class="min-w-0 flex-1 text-[13.5px] text-ink-700">{{ timeOnly(appt) }} &middot; {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}</span>
            </div>
            <PatientConfirmVisit class="mt-2" :appt="appt" :busy="confirmingId === appt.id" @confirm="confirmAttendance" />
            <div v-if="canChange(appt) && (settings.rescheduleEnabled || settings.cancelEnabled)" class="mt-1.5 flex items-center gap-4">
              <button v-if="settings.rescheduleEnabled" type="button" class="min-h-9 text-[12.5px] font-medium text-brand-text" :disabled="busyId === appt.id" @click="goReschedule(appt.id)">{{ t('Reschedule', 'Cambiar') }}</button>
              <button v-if="settings.cancelEnabled" type="button" class="min-h-9 text-[12.5px] font-medium text-danger-text" :disabled="busyId === appt.id" @click="cancel(appt, formatWhen(appt))">
                {{ busyId === appt.id ? t('Cancelling…', 'Cancelando…') : t('Cancel', 'Cancelar') }}
              </button>
            </div>
          </li>
        </ul>
      </PatientCard>

      <!-- What has happened -->
      <PatientCard class="mt-3" :title="past.length ? t(`History · ${past.length} visits`, `Historial · ${past.length} visitas`) : t('History', 'Historial')" flush>
        <ul v-if="past.length > 0" class="divide-y divide-line-divider" data-cy="patient-plan-history">
          <li v-for="appt in visiblePast" :key="appt.id" class="flex items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="text-[13px] text-ink-700">{{ formatWhen(appt) }}</p>
              <p class="text-[12px] text-ink-faint">{{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}</p>
            </div>
            <span class="shrink-0 rounded-pill bg-chip-bg px-2 py-0.5 text-[11.5px] font-medium text-chip-text">
              {{ t(PATIENT_APPOINTMENT_STATUS[appt.status]?.[0] ?? appt.status, PATIENT_APPOINTMENT_STATUS[appt.status]?.[1] ?? appt.status) }}
            </span>
          </li>
        </ul>
        <PatientLoadError v-else-if="loadError" @retry="reload" />
        <PatientEmpty v-else :text="t('Nothing here yet.', 'Todavía no hay nada aquí.')" />
        <button v-if="!showAllPast && past.length > PAST_PREVIEW" type="button" class="h-11 w-full border-t border-line-divider text-[13px] font-semibold text-ink-muted" @click="showAllPast = true">
          {{ t(`Show all ${past.length}`, `Ver las ${past.length} visitas`) }}
        </button>
      </PatientCard>

      <!-- Facturas: the latest, each to download; the rest on /billing -->
      <PatientCard class="mt-3" :title="t('Invoices', 'Facturas')" flush>
        <div v-if="invoicesLoading" class="p-4"><UiSkeleton class="h-8 w-full rounded-ctl" /></div>
        <ul v-else-if="recentInvoices.length > 0" class="divide-y divide-line-divider" data-cy="patient-plan-invoices">
          <li v-for="inv in recentInvoices" :key="inv.id" class="flex items-center gap-2.5 px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium text-ink-900">{{ inv.invoice_number ?? eur(inv.total_cents) }}</p>
              <p class="text-[12px] text-ink-faint">
                {{ new Date(inv.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) }}
                <template v-if="inv.invoice_number"> &middot; {{ eur(inv.total_cents) }}</template>
              </p>
            </div>
            <span class="shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-medium" :class="PATIENT_INVOICE_STATUS[inv.status]?.chip ?? 'bg-chip-bg text-chip-text'">
              {{ t(PATIENT_INVOICE_STATUS[inv.status]?.label[0] ?? inv.status, PATIENT_INVOICE_STATUS[inv.status]?.label[1] ?? inv.status) }}
            </span>
            <button
              type="button"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-600 disabled:opacity-50"
              :disabled="downloadingId === inv.id"
              :aria-label="t(`Download ${inv.invoice_number ?? 'invoice'} as PDF`, `Descargar ${inv.invoice_number ?? 'factura'} en PDF`)"
              @click="download(inv)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 2.5v7M5.4 7.2L8 9.8l2.6-2.6M3 12.5h10" />
              </svg>
            </button>
          </li>
        </ul>
        <PatientLoadError v-else-if="invoicesError" @retry="reloadInvoices" />
        <PatientEmpty v-else :text="t('No invoices yet.', 'Todavía no hay facturas.')" />
        <NuxtLink v-if="invoices.length > 0" to="/billing" class="flex h-11 items-center justify-center border-t border-line-divider text-[13px] font-semibold text-brand-text" data-cy="patient-plan-all-invoices">
          {{ t('See all invoices', 'Ver todas las facturas') }}
        </NuxtLink>
      </PatientCard>
    </template>
  </PatientScreen>
</template>
