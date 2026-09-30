<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { WEEK, dayRangesText } from '~/utils/clinicHours'
import { formatEur } from '~/utils/billing'
import { orderTypes } from '~/utils/appointmentTypes'
import { nextDate, startOfLocalDate } from '~/utils/clinicClock'
import { normalizeNotifyEmail, normalizeNotifyWhatsapp } from '~/utils/notifyContacts'
import type { Tables, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const config = useRuntimeConfig()
const t = useT()

// One page of sections, not five tabs: the tabs hid the booking link, the
// clinics and the notifications behind each other, and "which tab was it
// on" was the question every visit started with.
const SECTIONS = computed(() => [
  { id: 'where', label: t('Where & what', 'Dónde y qué') },
  { id: 'rules', label: t('Rules', 'Reglas') },
  { id: 'look', label: t('Look', 'Aspecto') },
  { id: 'texts', label: t('Texts', 'Textos') },
  { id: 'codes', label: t('Discount codes', 'Códigos de descuento') },
  { id: 'notify', label: t('Notifications', 'Avisos') },
  { id: 'tracking', label: t('Tracking', 'Seguimiento') },
])

// --- account-wide settings (General / Layout / Language) ---
const maxDaysAhead = ref(90)
const gtmId = ref('')
const successUrl = ref('')
const primaryColor = ref('')
const secondaryColor = ref('')
const backgroundColor = ref('')
const hideLogo = ref(false)
const practitionerOrder = ref<'default' | 'alphabetical'>('default')
const textOverrides = ref<Record<string, string>>({})
const notifyEmail = ref('')
const notifyWhatsapp = ref('')

const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)

async function loadAccountSettings() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'online_booking_max_days_ahead, online_booking_gtm_id, online_booking_success_url, online_booking_primary_color, online_booking_secondary_color, online_booking_background_color, online_booking_hide_logo, online_booking_practitioner_order, online_booking_text_overrides, online_booking_notify_email, online_booking_notify_whatsapp',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  maxDaysAhead.value = data?.online_booking_max_days_ahead ?? 90
  gtmId.value = data?.online_booking_gtm_id ?? ''
  successUrl.value = data?.online_booking_success_url ?? ''
  primaryColor.value = data?.online_booking_primary_color ?? ''
  secondaryColor.value = data?.online_booking_secondary_color ?? ''
  backgroundColor.value = data?.online_booking_background_color ?? ''
  hideLogo.value = data?.online_booking_hide_logo ?? false
  practitionerOrder.value = (data?.online_booking_practitioner_order as 'default' | 'alphabetical') ?? 'default'
  const overrides = { ...((data?.online_booking_text_overrides as Record<string, string>) ?? {}) }
  // This page used to save the practitioner heading as 'choose_practitioner',
  // a key the booking page never looked up (it reads 'select_heading'), so the
  // override never showed. Carried across here and written back on save.
  if (overrides.choose_practitioner && !overrides.select_heading) overrides.select_heading = overrides.choose_practitioner
  delete overrides.choose_practitioner
  textOverrides.value = overrides
  notifyEmail.value = data?.online_booking_notify_email ?? ''
  notifyWhatsapp.value = data?.online_booking_notify_whatsapp ?? ''
  loading.value = false
}
onMounted(loadAccountSettings)

// The booking page only follows this if it parses as an http(s) URL (a
// javascript: one would run as script on a public page), so a bare
// "mysite.com/gracias" would otherwise save happily and then silently do
// nothing. Assume https when no scheme is given, and refuse anything that
// still isn't a web address rather than storing a value that can't work.
function normalizedSuccessUrl(): { ok: true; value: string | null } | { ok: false } {
  const raw = successUrl.value.trim()
  if (!raw) return { ok: true, value: null }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false }
    return { ok: true, value: parsed.href }
  } catch {
    return { ok: false }
  }
}

async function saveAccountSettings() {
  const success = normalizedSuccessUrl()
  if (!success.ok) {
    showToast(t('The successful booking page must be a web address, e.g. https://mysite.com/gracias', 'La página de reserva completada debe ser una dirección web, p. ej. https://mysite.com/gracias'), 'error')
    return
  }
  successUrl.value = success.value ?? ''
  const notifyEmailValue = normalizeNotifyEmail(notifyEmail.value)
  const notifyWhatsappValue = normalizeNotifyWhatsapp(notifyWhatsapp.value, store.defaultPhoneCountry)
  if (notifyEmailValue === undefined) {
    showToast(t('The alert email is not an email address.', 'El correo de aviso no es una dirección de correo.'), 'error')
    return
  }
  if (notifyWhatsappValue === undefined) {
    showToast(t('The alert WhatsApp is not a phone number.', 'El WhatsApp de aviso no es un número de teléfono.'), 'error')
    return
  }
  notifyEmail.value = notifyEmailValue ?? ''
  notifyWhatsapp.value = notifyWhatsappValue ?? ''

  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    // A cleared box is '' and Postgres would refuse it.
    online_booking_max_days_ahead: Number(maxDaysAhead.value) || 90,
    online_booking_gtm_id: gtmId.value.trim() || null,
    online_booking_success_url: success.value,
    online_booking_primary_color: primaryColor.value.trim() || null,
    online_booking_secondary_color: secondaryColor.value.trim() || null,
    online_booking_background_color: backgroundColor.value.trim() || null,
    online_booking_hide_logo: hideLogo.value,
    online_booking_practitioner_order: practitionerOrder.value,
    online_booking_text_overrides: textOverrides.value,
    online_booking_notify_email: notifyEmailValue,
    online_booking_notify_whatsapp: notifyWhatsappValue,
  }
  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

// Both builders below read window.location, which does not exist while the
// page renders on the server. The card that uses them renders once mounted.
const mounted = ref(false)
onMounted(() => (mounted.value = true))

function bookingUrl(slug: string) {
  const domain = config.public.appDomain
  if (!domain) return `${window.location.origin}/book/${slug}`
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${slug}.${domain}${port}/`
}
function copy(text: string) {
  navigator.clipboard?.writeText(text)
}

/**
 * What a clinic pastes into its own website to embed the booking widget.
 *
 * The script tag is the part that is easy to leave out and expensive to
 * leave out. The widget reads gclid/utm_* from its own query string, and an
 * iframe src does not inherit the page's -- so an embed without embed.js
 * records every booking as though it arrived from nowhere, including the ones
 * an ad was paid for. That was true of our own site for a week: 7 bookings,
 * none carrying a campaign, against 48 paid clicks to the page in the same
 * window. Handing over a snippet that already has it is the only version of
 * this a clinic cannot get wrong.
 *
 * Built from the origin the clinic is looking at rather than a constant, so
 * the snippet is right in development and on any future domain without
 * anyone remembering to change it here.
 */
function embedSnippet(slug: string) {
  const origin = window.location.origin
  return `<div data-quiroflow-booking data-slug="${slug}"></div>\n<script src="${origin}/embed.js" async><\/script>`
}

// --- Clinics & Hours: per-clinic enable toggle ---
// The hours themselves are edited on each clinic's own page
// (Settings -> Clinics -> <clinic>): they are the calendar's and the API's too,
// not only online booking's, and editing one object in two places is how the
// two copies of a form drift. Shown here read-only, next to the switch.
type BookingClinic = Pick<Tables<'clinics'>, 'id' | 'name' | 'online_booking_enabled' | 'timezone'> & { business_hours: BusinessHours | null }

const bookingClinics = ref<BookingClinic[]>([])
const savingClinicId = ref<string | null>(null)
const hoursError = ref('')

async function loadBookingClinics() {
  const { data } = await supabase.from('clinics').select('id, name, online_booking_enabled, business_hours, timezone').is('archived_at', null).order('name')
  bookingClinics.value = (data as unknown as BookingClinic[]) ?? []
}
onMounted(loadBookingClinics)

async function setBookingEnabled(c: BookingClinic, enabled: boolean) {
  hoursError.value = ''
  savingClinicId.value = c.id
  // Read back: an update RLS refuses is not an error, it changes nothing --
  // and without this the switch flipped on screen and was off again on reload.
  const { data: saved, error: updateError } = await supabase.from('clinics').update({ online_booking_enabled: enabled }).eq('id', c.id).select('id')
  savingClinicId.value = null
  if (updateError || !saved?.length) {
    hoursError.value = updateError?.message ?? t('This change was not saved: your role cannot change clinics.', 'No se ha guardado: tu rol no puede cambiar las sedes.')
    return
  }
  c.online_booking_enabled = enabled
}

function hoursLines(c: BookingClinic) {
  return WEEK.map((d) => ({ key: d.key, label: t(d.en.slice(0, 3), d.es.slice(0, 3)), text: dayRangesText(c.business_hours, d.key, t('and', 'y')) }))
}

// --- What can be booked ---
// Each type's booking rules -- whether it is bookable online, who may book
// it, the practitioner choice, how far ahead, payment and deposit -- are
// edited on the type's own page (Settings -> Appointment Types -> <type>).
// They used to be split between that list's switches and a "Bookable
// Entities" tab here, which is how a deposit came to sit on a type that was
// no longer offered online. This lists the types and links to each.
type BookableType = Pick<Tables<'appointment_types'>, 'id' | 'name' | 'online_booking_enabled' | 'sort_order'>
const types = ref<BookableType[]>([])

async function loadTypes() {
  const { data } = await supabase.from('appointment_types').select('id, name, online_booking_enabled, sort_order').is('archived_at', null)
  types.value = orderTypes(data ?? [])
}
onMounted(loadTypes)

// --- Discount codes ---
const codes = ref<Tables<'online_booking_discount_codes'>[]>([])
const newCode = ref('')
const newPercentOff = ref('')
const newAmountOff = ref('')
const newExpiresAt = ref('')
const newMaxUses = ref('')
const addingCode = ref(false)
const codeError = ref('')

async function loadCodes() {
  const { data } = await supabase.from('online_booking_discount_codes').select('*').order('created_at', { ascending: false })
  codes.value = data ?? []
}
onMounted(loadCodes)

async function addCode() {
  codeError.value = ''
  if (!newCode.value.trim()) return
  addingCode.value = true
  const { error } = await supabase.from('online_booking_discount_codes').insert({
    account_id: store.accountId!,
    code: newCode.value.trim().toUpperCase(),
    percent_off: newPercentOff.value ? parseInt(newPercentOff.value, 10) : null,
    amount_off_cents: newAmountOff.value ? Math.round(parseFloat(newAmountOff.value) * 100) : null,
    // Valid through the whole chosen day at the clinic. new Date('2026-10-31')
    // is UTC midnight, which in Madrid stopped the code at 01:00/02:00 ON the
    // 31st and then said it had expired that day.
    expires_at: newExpiresAt.value ? startOfLocalDate(nextDate(newExpiresAt.value), codesTimeZone.value).toISOString() : null,
    max_uses: newMaxUses.value ? parseInt(newMaxUses.value, 10) : null,
  })
  addingCode.value = false
  if (error) {
    codeError.value = error.message
    return
  }
  newCode.value = ''
  newPercentOff.value = ''
  newAmountOff.value = ''
  newExpiresAt.value = ''
  newMaxUses.value = ''
  await loadCodes()
}

// Discount codes are account-wide; the day a code runs to is the clinic's.
const codesTimeZone = computed(() => bookingClinics.value[0]?.timezone ?? 'Europe/Madrid')

async function toggleCodeActive(c: Tables<'online_booking_discount_codes'>) {
  const { data, error } = await supabase.from('online_booking_discount_codes').update({ active: !c.active }).eq('id', c.id).select('active')
  if (error || !data?.length) {
    showToast(error?.message ?? t('This change was not saved.', 'No se ha guardado el cambio.'), 'error')
    return
  }
  c.active = data[0]!.active
}

// Asked in an in-app dialog: a deleted code stops working for anyone
// holding it, and there is no undo.
const deletingCode = ref<Tables<'online_booking_discount_codes'> | null>(null)
async function confirmRemoveCode() {
  const c = deletingCode.value
  if (!c) return
  const { data, error } = await supabase.from('online_booking_discount_codes').delete().eq('id', c.id).select('id')
  if (error || !data?.length) {
    showToast(error?.message ?? t('The code was not deleted.', 'No se ha eliminado el código.'), 'error')
    return
  }
  deletingCode.value = null
  await loadCodes()
}

// Fixed set of the public booking widget's own strings -- pages/book/[slug].vue
// isn't built on a keyed i18n catalog, so unlike PracticeHub's full
// translation search this only covers the handful of strings that page
// actually looks up against online_booking_text_overrides.
// Every key the booking page looks up, in the order a patient meets them. A
// key here that the page does not read is an override that silently does
// nothing -- which 'choose_practitioner' was until it became 'select_heading'.
const OVERRIDABLE_STRINGS = [
  { key: 'heading', default: 'Reservar una cita' },
  { key: 'select_heading', default: 'Elija un profesional' },
  { key: 'any_practitioner_label', default: 'Cualquier profesional' },
  { key: 'any_practitioner_description', default: 'Esta opción le permite reservar una cita con cualquier profesional disponible en la especialidad y horario seleccionados.' },
  { key: 'choose_datetime', default: 'Elija su fecha y hora' },
  { key: 'enter_details', default: 'Introduzca sus datos' },
  { key: 'confirm_button', default: 'Reservar cita' },
  { key: 'success_heading', default: '¡Cita reservada!' },
  { key: 'app_promo_heading', default: 'Descarga la app de QuiroFlow' },
]

function setOverride(key: string, value: string) {
  const next = { ...textOverrides.value }
  if (value.trim()) next[key] = value
  else delete next[key]
  textOverrides.value = next
}

// --- the status line at the top ---
const bookableClinics = computed(() => bookingClinics.value.filter((c) => c.online_booking_enabled).length)
const onlineTypes = computed(() => types.value.filter((x) => x.online_booking_enabled).length)

// Discount code, in words: "10% off", "5,00 € off", or both.
function codeOff(c: Tables<'online_booking_discount_codes'>) {
  const parts = [c.percent_off ? t(`${c.percent_off}% off`, `${c.percent_off}% de descuento`) : '', c.amount_off_cents ? t(`${formatEur(c.amount_off_cents)} off`, `${formatEur(c.amount_off_cents)} de descuento`) : '']
  return parts.filter(Boolean).join(' + ') || t('No discount set', 'Sin descuento')
}
function codeMeta(c: Tables<'online_booking_discount_codes'>) {
  const used = c.max_uses ? t(`${c.times_used} of ${c.max_uses} used`, `${c.times_used} de ${c.max_uses} usados`) : t(`${c.times_used} used`, `${c.times_used} usados`)
  if (!c.expires_at) return used
  // The last day it works: the instant stored is the start of the day after.
  const day = new Date(new Date(c.expires_at).getTime() - 1).toLocaleDateString('es-ES', { timeZone: codesTimeZone.value })
  return new Date(c.expires_at).getTime() < Date.now() ? t(`${used} · expired ${day}`, `${used} · caducó el ${day}`) : t(`${used} · expires ${day}`, `${used} · caduca el ${day}`)
}

const pickerClass = 'h-9 touch:h-11 w-12 shrink-0 cursor-pointer rounded-ctl border border-line-control bg-surface p-1'
const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Online Booking', 'Reserva online')">
      <UiBtn variant="primary" data-cy="booking-save" :disabled="saving || loading" @click="saveAccountSettings">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
      </UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="booking-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('How new patients book from your website: where and what they can book, what the page looks like, and who hears about it.', 'Cómo reservan los pacientes nuevos desde tu web: dónde y qué pueden reservar, cómo se ve la página y a quién se avisa.') }}
          </p>

          <!-- The page itself first: the link and the embed are what people come here to copy. -->
          <section v-if="store.accountSlug && mounted" aria-labelledby="h-page" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex flex-wrap items-start gap-3.5 px-[18px] py-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]" :class="bookableClinics > 0 && onlineTypes > 0 ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text'" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
              </span>
              <div class="flex min-w-[220px] flex-1 flex-col gap-1">
                <h2 id="h-page" class="text-[16px] font-bold text-ink-900">
                  {{ bookableClinics > 0 && onlineTypes > 0 ? t('Your booking page is live', 'Tu página de reservas está activa') : t('Nothing can be booked yet', 'Aún no se puede reservar nada') }}
                </h2>
                <p class="text-[13.5px] text-ink-500" data-cy="booking-status">
                  {{ t(`Bookable at ${bookableClinics} of ${bookingClinics.length} clinics, for ${onlineTypes} of ${types.length} appointment types.`, `Se puede reservar en ${bookableClinics} de ${bookingClinics.length} clínicas, para ${onlineTypes} de ${types.length} tipos de cita.`) }}
                </p>
              </div>
              <a :href="bookingUrl(store.accountSlug)" target="_blank" rel="noopener" class="inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                {{ t('Open page', 'Abrir página') }}
              </a>
            </div>
            <div class="flex flex-col gap-2.5 border-t border-line-row px-[18px] pb-4 pt-3.5" data-test="booking-embed-card">
              <div class="flex flex-wrap items-center gap-2.5">
                <span class="w-[110px] shrink-0 text-[13.5px] font-semibold text-ink-700">{{ t('Link', 'Enlace') }}</span>
                <code class="min-w-0 flex-1 truncate rounded-ctlSm bg-surface-page px-2.5 py-2 font-mono text-[12.5px] text-ink-500">{{ bookingUrl(store.accountSlug) }}</code>
                <UiBtn class="w-24" @click="copy(bookingUrl(store.accountSlug))">{{ t('Copy', 'Copiar') }}</UiBtn>
              </div>
              <div class="flex flex-wrap items-start gap-2.5">
                <span class="w-[110px] shrink-0 pt-2 text-[13.5px] font-semibold text-ink-700">{{ t('Website embed', 'Insertar en tu web') }}</span>
                <textarea
                  :value="embedSnippet(store.accountSlug)"
                  data-test="booking-embed-snippet"
                  readonly
                  rows="2"
                  :aria-label="t('Website embed code', 'Código para insertar en tu web')"
                  class="min-w-0 flex-1 resize-none rounded-ctlSm border-0 bg-surface-page px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink-500"
                />
                <UiBtn class="w-24" @click="copy(embedSnippet(store.accountSlug))">{{ t('Copy', 'Copiar') }}</UiBtn>
              </div>
              <p class="text-[12.5px] text-ink-muted sm:ml-[120px]">
                {{ t('The script tells paid bookings (Google, Meta) apart from the rest. Already embedded the widget by hand? Adding just the script tag is enough.', 'El script distingue las reservas de pago (Google, Meta) del resto. ¿Ya insertaste el widget a mano? Basta con añadir la etiqueta script.') }}
              </p>
            </div>
          </section>

          <nav :aria-label="t('Sections', 'Secciones')" class="flex flex-wrap gap-2">
            <a v-for="s in SECTIONS" :key="s.id" :href="`#${s.id}`" class="inline-flex h-8 touch:h-11 items-center rounded-pill border border-line-control bg-surface px-3 text-[13px] text-ink-500 hover:border-line-controlHover">{{ s.label }}</a>
          </nav>

          <!-- Where & what -->
          <section id="where" aria-labelledby="h-where" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-where" class="text-[16px] font-bold text-ink-900">{{ t('Where & what can be booked', 'Dónde y qué se puede reservar') }}</h2>
              <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                {{ t('Hours are each clinic’s own. Each appointment type decides whether it is bookable online, how far ahead and whether it is paid when booking.', 'El horario es el de cada clínica. Cada tipo de cita decide si se reserva online, con cuánta antelación y si se paga al reservar.') }}
              </p>
            </div>
            <div v-for="c in bookingClinics" :key="c.id" class="flex flex-wrap items-start gap-4 border-t border-line-row px-[18px] py-3" data-cy="booking-clinic" :data-clinic-id="c.id">
              <button
                type="button"
                role="switch"
                data-cy="booking-clinic-toggle"
                :aria-checked="c.online_booking_enabled"
                :aria-label="t(`Online booking at ${c.name}`, `Reserva online en ${c.name}`)"
                :disabled="savingClinicId === c.id"
                class="relative mt-0.5 h-[26px] w-11 shrink-0 rounded-full disabled:opacity-50"
                :class="c.online_booking_enabled ? 'bg-brand' : 'bg-line-control'"
                @click="setBookingEnabled(c, !c.online_booking_enabled)"
              >
                <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="c.online_booking_enabled ? 'left-[21px]' : 'left-[3px]'" />
              </button>
              <div class="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <strong class="text-[14.5px] text-ink-900">{{ c.name }}</strong>
                <dl class="grid grid-cols-[40px_1fr] gap-x-2 gap-y-0.5 text-[12.5px]" data-cy="booking-clinic-hours">
                  <template v-for="d in hoursLines(c)" :key="d.key">
                    <dt class="text-ink-muted">{{ d.label }}</dt>
                    <dd :class="d.text ? 'text-ink-700' : 'text-ink-faint'">{{ d.text ?? t('Closed', 'Cerrado') }}</dd>
                  </template>
                </dl>
              </div>
              <NuxtLink :to="`/settings/clinics/${c.id}#horario`" class="text-[13px] font-semibold text-brand-text hover:text-brand-hover" data-cy="booking-clinic-edit-hours">
                {{ t('Edit hours', 'Editar horario') }}
              </NuxtLink>
            </div>
            <p v-if="bookingClinics.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('No clinics yet.', 'Todavía no hay clínicas.') }}</p>
            <p v-if="hoursError" class="border-t border-line-row px-[18px] py-2.5 text-[12.5px] font-semibold text-danger-text">{{ hoursError }}</p>

            <div class="flex flex-col gap-2 border-t border-line px-[18px] pb-4 pt-3" data-cy="booking-types-note">
              <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Appointment types', 'Tipos de cita') }}</span>
              <ul v-if="types.length > 0" class="flex flex-wrap gap-1.5">
                <li v-for="at in types" :key="at.id">
                  <NuxtLink
                    :to="`/settings/appointment-types/${at.id}#online`"
                    data-cy="booking-type-link"
                    class="inline-flex min-h-[32px] items-center gap-1.5 rounded-pill border border-line-control px-3 text-[13px] font-semibold hover:bg-surface-subtle"
                    :class="at.online_booking_enabled ? 'bg-surface text-ink-700' : 'bg-surface-subtle text-ink-muted'"
                  >
                    {{ at.name }}
                    <span class="font-normal">· {{ at.online_booking_enabled ? t('online', 'online') : t('not online', 'no online') }}</span>
                  </NuxtLink>
                </li>
              </ul>
              <NuxtLink v-else to="/settings/appointment-types" class="text-[13px] font-semibold text-brand-text hover:underline">{{ t('Create an appointment type', 'Crea un tipo de cita') }}</NuxtLink>
            </div>
          </section>

          <template v-if="loading">
            <UiSkeleton class="h-32 w-full rounded-card" />
            <UiSkeleton class="h-64 w-full rounded-card" />
          </template>
          <template v-else>
            <!-- Rules -->
            <section id="rules" aria-labelledby="h-rules" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <h2 id="h-rules" class="px-[18px] pb-2 pt-4 text-[16px] font-bold text-ink-900">{{ t('Rules', 'Reglas') }}</h2>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="max-days" class="text-[14.5px] font-bold text-ink-900">{{ t('How far ahead', 'Con cuánta antelación') }}</label>
                  <span class="text-[13px] text-ink-500">{{ t('The furthest ahead a patient can book. An appointment type can set its own.', 'Lo más lejos que un paciente puede reservar. Un tipo de cita puede fijar la suya.') }}</span>
                </div>
                <label class="flex items-center gap-2 text-[14px] text-ink-500">
                  <input id="max-days" v-model.number="maxDaysAhead" type="number" min="1" data-cy="booking-max-days" :class="[inputClass, 'w-20 text-right']" />
                  {{ t('days', 'días') }}
                </label>
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <strong id="order-label" class="text-[14.5px] text-ink-900">{{ t('Practitioner order', 'Orden de los profesionales') }}</strong>
                  <span class="text-[13px] text-ink-500">{{ t('How practitioners are listed when a patient picks one.', 'Cómo se listan los profesionales cuando el paciente elige uno.') }}</span>
                </div>
                <div role="radiogroup" aria-labelledby="order-label" class="inline-flex gap-0.5 rounded-[9px] bg-chip-bg p-[3px]">
                  <button
                    v-for="o in [{ value: 'default', label: t('As added', 'Por alta') }, { value: 'alphabetical', label: t('A to Z', 'De la A a la Z') }]"
                    :key="o.value"
                    type="button"
                    role="radio"
                    :data-cy="`booking-order-${o.value}`"
                    :aria-checked="practitionerOrder === o.value"
                    class="h-8 touch:h-11 rounded-[7px] px-3 text-[13px]"
                    :class="practitionerOrder === o.value ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'"
                    @click="practitionerOrder = o.value as 'default' | 'alphabetical'"
                  >
                    {{ o.label }}
                  </button>
                </div>
              </div>
            </section>

            <!-- Look, beside the page it changes -->
            <section id="look" aria-labelledby="h-look" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-2 pt-4">
                <h2 id="h-look" class="text-[16px] font-bold text-ink-900">{{ t('Look', 'Aspecto') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('The page is always light; the background lets it blend into a site that embeds it.', 'La página siempre es clara; el fondo permite integrarla en la web que la inserta.') }}</p>
              </div>
              <div class="flex flex-col gap-6 px-[18px] pb-[18px] pt-1 md:flex-row">
                <div class="flex min-w-0 flex-1 flex-col">
                  <div v-for="c in [
                    { key: 'primary', label: t('Main colour', 'Color principal'), model: primaryColor, set: (v: string) => (primaryColor = v), placeholder: '#4C6FEB' },
                    { key: 'secondary', label: t('Soft colour', 'Color suave'), model: secondaryColor, set: (v: string) => (secondaryColor = v), placeholder: '#EEF1FF' },
                    { key: 'background', label: t('Background', 'Fondo'), model: backgroundColor, set: (v: string) => (backgroundColor = v), placeholder: '#F7F8FA' },
                  ]" :key="c.key" class="flex min-h-[52px] items-center gap-3 border-b border-line-row">
                    <label :for="`color-${c.key}`" class="flex-1 text-[14px] text-ink-900">{{ c.label }}</label>
                    <input type="color" :value="c.model || c.placeholder" :aria-label="c.label" :class="pickerClass" @input="c.set(($event.target as HTMLInputElement).value)" />
                    <input :id="`color-${c.key}`" :value="c.model" type="text" :placeholder="c.placeholder" :data-cy="`booking-color-${c.key}`" :class="[inputClass, 'w-28 font-mono text-[13px]']" @input="c.set(($event.target as HTMLInputElement).value)" />
                  </div>
                  <div class="flex min-h-[52px] items-center gap-3">
                    <span id="logo-label" class="flex-1 text-[14px] text-ink-900">{{ t('Show your logo', 'Mostrar tu logotipo') }}</span>
                    <button
                      type="button"
                      role="switch"
                      data-cy="booking-show-logo"
                      :aria-checked="!hideLogo"
                      aria-labelledby="logo-label"
                      class="relative h-[26px] w-11 shrink-0 rounded-full"
                      :class="!hideLogo ? 'bg-brand' : 'bg-line-control'"
                      @click="hideLogo = !hideLogo"
                    >
                      <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="!hideLogo ? 'left-[21px]' : 'left-[3px]'" />
                    </button>
                  </div>
                </div>
                <!-- An illustration of the colours, not the page itself. -->
                <figure class="flex w-full shrink-0 flex-col gap-2 md:w-[320px]" aria-hidden="true">
                  <figcaption class="text-[12.5px] font-semibold text-ink-500">{{ t('Preview', 'Vista previa') }}</figcaption>
                  <div class="flex flex-col items-center gap-3 rounded-card border border-line px-[18px] py-5" :style="{ background: backgroundColor || '#F7F8FA' }">
                    <span v-if="!hideLogo" class="flex h-10 w-10 items-center justify-center rounded-[10px] text-[11px] font-bold text-white" :style="{ background: primaryColor || '#4C6FEB' }">LOGO</span>
                    <strong class="text-[17px] text-[#15171E]">{{ textOverrides.heading || 'Reservar una cita' }}</strong>
                    <div class="flex w-full flex-col gap-2">
                      <div class="flex items-center gap-2.5 rounded-ctl border-[1.5px] bg-white px-3 py-2.5" :style="{ borderColor: primaryColor || '#4C6FEB' }">
                        <span class="h-7 w-7 rounded-full" :style="{ background: secondaryColor || '#EEF1FF' }" />
                        <span class="text-[13px] font-semibold text-[#15171E]">{{ textOverrides.any_practitioner_label || 'Cualquier profesional' }}</span>
                      </div>
                      <div class="flex items-center gap-2.5 rounded-ctl border border-[#E8E9ED] bg-white px-3 py-2.5">
                        <span class="h-7 w-7 rounded-full" :style="{ background: secondaryColor || '#EEF1FF' }" />
                        <span class="text-[13px] text-[#15171E]">{{ t('A practitioner', 'Un profesional') }}</span>
                      </div>
                    </div>
                    <span class="flex h-9 w-full items-center justify-center rounded-ctl text-[13px] font-semibold text-white" :style="{ background: primaryColor || '#4C6FEB' }">{{ textOverrides.confirm_button || 'Reservar cita' }}</span>
                  </div>
                </figure>
              </div>
            </section>

            <!-- Texts -->
            <section id="texts" aria-labelledby="h-texts" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-texts" class="text-[16px] font-bold text-ink-900">{{ t('Texts', 'Textos') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('Replace any of the booking page’s own words. Leave a line empty to keep the original.', 'Sustituye cualquier texto de la página de reservas. Deja una línea vacía para mantener el original.') }}</p>
              </div>
              <div v-for="s in OVERRIDABLE_STRINGS" :key="s.key" class="grid grid-cols-1 items-center gap-2 border-t border-line-row px-[18px] py-2.5 sm:grid-cols-2 sm:gap-4" :data-text-key="s.key">
                <label :for="`text-${s.key}`" class="line-clamp-2 text-[13.5px] text-ink-500">{{ s.default }}</label>
                <input
                  :id="`text-${s.key}`"
                  :value="textOverrides[s.key] ?? ''"
                  type="text"
                  :placeholder="s.default"
                  data-cy="booking-text"
                  :class="[inputClass, 'w-full']"
                  @input="setOverride(s.key, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </section>
          </template>

          <!-- Discount codes: saved as they change, like the clinic switches -->
          <section id="codes" aria-labelledby="h-codes" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <h2 id="h-codes" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Discount codes · ${codes.length}`, `Códigos de descuento · ${codes.length}`) }}</h2>
              <span v-if="codes.length" class="text-[13px] text-ink-muted">{{ t('Active', 'Activo') }}</span>
            </div>
            <p v-if="codes.length === 0" class="border-t border-line-row px-[18px] py-5 text-center text-[14px] text-ink-muted">{{ t('No discount codes yet.', 'Todavía no hay códigos de descuento.') }}</p>
            <div v-for="c in codes" :key="c.id" data-cy="booking-code" class="flex min-h-[60px] flex-wrap items-center gap-3.5 border-t border-line-row py-2 pl-[18px] pr-3">
              <code class="rounded-ctlSm bg-brand-tint px-2.5 py-1 font-mono text-[13.5px] font-semibold text-brand-text">{{ c.code }}</code>
              <div class="flex min-w-[160px] flex-1 flex-col gap-0.5">
                <strong class="text-[14.5px] text-ink-900">{{ codeOff(c) }}</strong>
                <span class="text-[13px] text-ink-500">{{ codeMeta(c) }}</span>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="c.active"
                :aria-label="t(`${c.code} active`, `${c.code} activo`)"
                class="relative h-[26px] w-11 shrink-0 rounded-full"
                :class="c.active ? 'bg-brand' : 'bg-line-control'"
                @click="toggleCodeActive(c)"
              >
                <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="c.active ? 'left-[21px]' : 'left-[3px]'" />
              </button>
              <button type="button" class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700" :aria-label="t(`Delete ${c.code}`, `Eliminar ${c.code}`)" data-cy="code-delete" @click="deletingCode = c">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
            </div>
            <form class="grid grid-cols-2 items-end gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3 sm:grid-cols-[1.3fr_.7fr_.7fr_1fr_.8fr_auto]" @submit.prevent="addCode">
              <label class="col-span-2 flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700 sm:col-span-1">{{ t('Code', 'Código') }}<input v-model="newCode" type="text" required placeholder="BIENVENIDA" :class="[inputClass, 'uppercase']" /></label>
              <label class="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700">{{ t('% off', '% dto.') }}<input v-model="newPercentOff" type="number" min="1" max="100" :class="inputClass" /></label>
              <label class="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700">{{ t('€ off', '€ dto.') }}<input v-model="newAmountOff" type="number" min="0" step="0.01" :class="inputClass" /></label>
              <label class="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700">{{ t('Expires', 'Caduca') }}<input v-model="newExpiresAt" type="date" :class="inputClass" /></label>
              <label class="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700">{{ t('Max uses', 'Usos máx.') }}<input v-model="newMaxUses" type="number" min="1" placeholder="∞" :class="inputClass" /></label>
              <UiBtn type="submit" :disabled="addingCode">{{ addingCode ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="codeError" class="col-span-full text-[12.5px] font-semibold text-danger-text">{{ codeError }}</p>
            </form>
          </section>

          <template v-if="!loading">
            <!-- Notifications -->
            <section id="notify" aria-labelledby="h-notify" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <h2 id="h-notify" class="px-[18px] pb-2 pt-4 text-[16px] font-bold text-ink-900">{{ t('Tell the clinic about new bookings', 'Avisar a la clínica de las reservas') }}</h2>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="notify-email" class="text-[14.5px] font-bold text-ink-900">{{ t('By email', 'Por correo') }}</label>
                  <span class="text-[13px] text-ink-500">{{ t('Sent the moment a patient books.', 'Se envía en cuanto un paciente reserva.') }}</span>
                </div>
                <input id="notify-email" v-model="notifyEmail" type="email" placeholder="recepcion@clinica.es" :class="[inputClass, 'w-full sm:w-[280px]']" />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="notify-whatsapp" class="text-[14.5px] font-bold text-ink-900">{{ t('By WhatsApp', 'Por WhatsApp') }}</label>
                  <span class="text-[13px] leading-snug text-ink-500">
                    {{ t('In +34… format. When that number has not written to the clinic in 24 h, WhatsApp only delivers the staff booking template set in', 'En formato +34… Si ese número no ha escrito a la clínica en 24 h, WhatsApp solo entrega la plantilla de aviso de reserva configurada en') }}
                    <NuxtLink to="/settings/whatsapp" class="font-semibold text-brand-text hover:underline">WhatsApp</NuxtLink>.
                  </span>
                </div>
                <input id="notify-whatsapp" v-model="notifyWhatsapp" type="tel" placeholder="+34600000000" :class="[inputClass, 'w-full sm:w-[280px]']" />
              </div>
            </section>

            <!-- Tracking -->
            <section id="tracking" aria-labelledby="h-track" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-2 pt-4">
                <h2 id="h-track" class="text-[16px] font-bold text-ink-900">{{ t('Tracking', 'Seguimiento') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('For measuring ads. Leave empty if you don’t run any.', 'Para medir anuncios. Déjalo vacío si no tienes.') }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="gtm" class="text-[14.5px] font-bold text-ink-900">Google Tag Manager</label>
                  <span class="text-[13px] text-ink-500">{{ t('Loaded on the booking page.', 'Se carga en la página de reservas.') }}</span>
                </div>
                <input id="gtm" v-model="gtmId" type="text" placeholder="GTM-XXXXXXX" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[280px]']" />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="success-url" class="text-[14.5px] font-bold text-ink-900">{{ t('Thank-you page', 'Página de agradecimiento') }}</label>
                  <span class="text-[13px] leading-snug text-ink-500">
                    {{ t('Send patients to your own page after booking, instead of the built-in confirmation, to fire a conversion there. The booking, type, value and currency are added to the address.', 'Envía a los pacientes a tu propia página tras reservar, en lugar de la confirmación integrada, para registrar la conversión allí. La reserva, el tipo, el importe y la moneda se añaden a la dirección.') }}
                  </span>
                </div>
                <input id="success-url" v-model="successUrl" type="text" placeholder="https://mysite.com/gracias" :class="[inputClass, 'w-full sm:w-[280px]']" />
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
    <UiConfirmDialog
      v-if="deletingCode"
      tone="danger"
      :title="t(`Delete the code ${deletingCode.code}?`, `¿Eliminar el código ${deletingCode.code}?`)"
      :confirm-label="t('Delete code', 'Eliminar código')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmRemoveCode"
      @cancel="deletingCode = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Anyone holding it can no longer use it. Bookings already made with it keep their discount. To pause it instead, switch it off.', 'Quien lo tenga ya no podrá usarlo. Las reservas ya hechas conservan su descuento. Para pausarlo, desactívalo.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
