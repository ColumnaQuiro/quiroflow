<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { WEEK, dayRangesText } from '~/utils/clinicHours'
import { formatEur } from '~/utils/billing'
import { orderTypes } from '~/utils/appointmentTypes'
import type { Tables, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const config = useRuntimeConfig()
const t = useT()

const TAB_KEYS = ['general', 'hours', 'discounts', 'layout', 'language'] as const
const activeTab = ref<(typeof TAB_KEYS)[number]>('general')
const tabs = computed(() => [
  { key: 'general' as const, label: t('General', 'General') },
  { key: 'hours' as const, label: t('Clinics & Hours', 'Clínicas y horarios') },
  { key: 'discounts' as const, label: t('Discount Codes', 'Códigos de descuento') },
  { key: 'layout' as const, label: t('Layout', 'Diseño') },
  { key: 'language' as const, label: t('Language Overrides', 'Textos personalizados') },
])

// --- account-wide settings (General / Layout / Language) ---
const maxDaysAhead = ref(90)
const gtmId = ref('')
const referralUrl = ref('')
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
      'online_booking_max_days_ahead, online_booking_gtm_id, online_booking_referral_url, online_booking_success_url, online_booking_primary_color, online_booking_secondary_color, online_booking_background_color, online_booking_hide_logo, online_booking_practitioner_order, online_booking_text_overrides, online_booking_notify_email, online_booking_notify_whatsapp',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  maxDaysAhead.value = data?.online_booking_max_days_ahead ?? 90
  gtmId.value = data?.online_booking_gtm_id ?? ''
  referralUrl.value = data?.online_booking_referral_url ?? ''
  successUrl.value = data?.online_booking_success_url ?? ''
  primaryColor.value = data?.online_booking_primary_color ?? ''
  secondaryColor.value = data?.online_booking_secondary_color ?? ''
  backgroundColor.value = data?.online_booking_background_color ?? ''
  hideLogo.value = data?.online_booking_hide_logo ?? false
  practitionerOrder.value = (data?.online_booking_practitioner_order as 'default' | 'alphabetical') ?? 'default'
  textOverrides.value = (data?.online_booking_text_overrides as Record<string, string>) ?? {}
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

  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    online_booking_max_days_ahead: maxDaysAhead.value,
    online_booking_gtm_id: gtmId.value.trim() || null,
    online_booking_referral_url: referralUrl.value.trim() || null,
    online_booking_success_url: success.value,
    online_booking_primary_color: primaryColor.value.trim() || null,
    online_booking_secondary_color: secondaryColor.value.trim() || null,
    online_booking_background_color: backgroundColor.value.trim() || null,
    online_booking_hide_logo: hideLogo.value,
    online_booking_practitioner_order: practitionerOrder.value,
    online_booking_text_overrides: textOverrides.value,
    online_booking_notify_email: notifyEmail.value.trim() || null,
    online_booking_notify_whatsapp: notifyWhatsapp.value.trim() || null,
  }
  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

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
type BookingClinic = Pick<Tables<'clinics'>, 'id' | 'name' | 'online_booking_enabled'> & { business_hours: BusinessHours | null }

const bookingClinics = ref<BookingClinic[]>([])
const savingClinicId = ref<string | null>(null)
const hoursError = ref('')

async function loadBookingClinics() {
  const { data } = await supabase.from('clinics').select('id, name, online_booking_enabled, business_hours').is('archived_at', null).order('name')
  bookingClinics.value = (data as unknown as BookingClinic[]) ?? []
}
onMounted(loadBookingClinics)

async function setBookingEnabled(c: BookingClinic, enabled: boolean) {
  hoursError.value = ''
  savingClinicId.value = c.id
  const { error: updateError } = await supabase.from('clinics').update({ online_booking_enabled: enabled }).eq('id', c.id)
  savingClinicId.value = null
  if (updateError) {
    hoursError.value = updateError.message
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
    expires_at: newExpiresAt.value ? new Date(newExpiresAt.value).toISOString() : null,
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

async function toggleCodeActive(c: Tables<'online_booking_discount_codes'>) {
  c.active = !c.active
  await supabase.from('online_booking_discount_codes').update({ active: c.active }).eq('id', c.id)
}

async function removeCode(id: string) {
  await supabase.from('online_booking_discount_codes').delete().eq('id', id)
  await loadCodes()
}

// Fixed set of the public booking widget's own strings -- pages/book/[slug].vue
// isn't built on a keyed i18n catalog, so unlike PracticeHub's full
// translation search this only covers the handful of strings that page
// actually looks up against online_booking_text_overrides.
const OVERRIDABLE_STRINGS = [
  { key: 'heading', default: 'Reservar una cita' },
  { key: 'choose_practitioner', default: 'Elija un profesional' },
  { key: 'choose_datetime', default: 'Elija su fecha y hora' },
  { key: 'enter_details', default: 'Introduzca sus datos' },
  { key: 'confirm_button', default: 'Reservar cita' },
  { key: 'success_heading', default: '¡Cita reservada!' },
]
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Online Booking Settings', 'Ajustes de reserva online')">
      <UiBtn v-if="activeTab === 'general' || activeTab === 'layout' || activeTab === 'language'" variant="primary" :disabled="saving || loading" @click="saveAccountSettings">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
      </UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">{{ t('Configure how patients book appointments online.', 'Configura cómo reservan cita los pacientes online.') }}</p>

          <div class="mt-4 flex gap-1 border-b border-line">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="h-9 px-3 text-[13px]"
              :class="activeTab === tab.key ? 'border-b-2 border-brand font-semibold text-ink-900' : 'text-ink-muted hover:text-ink-700'"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- General -->
          <div v-if="activeTab === 'general'" class="mt-4 space-y-3">
            <div v-if="loading" class="space-y-3">
              <div v-for="i in 3" :key="i" class="space-y-1.5">
                <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
                <UiSkeleton class="h-8 w-40 rounded-ctl" />
              </div>
            </div>
            <template v-else>
              <SettingsFieldRow :label="t('Maximum future booking time', 'Máxima antelación de reserva')" :helper="t('How far ahead patients can book online. Each appointment type can set its own on its page.', 'Con cuánta antelación pueden reservar los pacientes online. Cada tipo de cita puede tener la suya en su página.')">
                <div class="flex items-center gap-2">
                  <input v-model.number="maxDaysAhead" type="number" min="1" class="h-8 w-20 rounded-ctl border border-line-control bg-surface px-2 text-center text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
                  <span class="text-[13px] text-ink-muted2">{{ t('days', 'días') }}</span>
                </div>
              </SettingsFieldRow>

              <SettingsFieldRow :label="t('Google Tag Manager', 'Google Tag Manager')" :helper="t('Injected on the public booking page for conversion tracking.', 'Se inserta en la página pública de reserva para el seguimiento de conversiones.')">
                <input v-model="gtmId" type="text" placeholder="GTM-XXXXXXX" class="h-8 w-40 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </SettingsFieldRow>

              <SettingsFieldRow :label="t('Patient referral URL', 'URL de referidos de paciente')" :helper="t('Where a referred-patient link redirects to, if you track referrals separately.', 'Adónde redirige el enlace de paciente referido, si haces un seguimiento de referidos por separado.')">
                <input v-model="referralUrl" type="text" placeholder="https://mysite.com/referral" class="h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </SettingsFieldRow>

              <SettingsFieldRow
                :label="t('Successful booking page', 'Página de reserva completada')"
                :helper="
                  t(
                    'Send patients to your own page once a booking goes through, instead of the built-in confirmation screen. Useful for firing a conversion tag on a thank-you page. The booking, type, value and currency are added to the address as query parameters so your tag can report the real amount. Leave blank to keep the built-in screen.',
                    'Envía a los pacientes a tu propia página cuando se completa una reserva, en lugar de la pantalla de confirmación integrada. Útil para lanzar una etiqueta de conversión en una página de agradecimiento. La reserva, el tipo, el importe y la moneda se añaden a la dirección como parámetros para que tu etiqueta pueda informar del valor real. Déjalo en blanco para mantener la pantalla integrada.',
                  )
                "
              >
                <input v-model="successUrl" type="text" placeholder="https://mysite.com/gracias" class="h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </SettingsFieldRow>

              <div v-if="store.accountSlug" class="rounded-card border border-line bg-surface p-4 shadow-card">
                <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Public booking link', 'Enlace de reserva público') }}</p>
                <div class="mt-2 flex items-center gap-2">
                  <input :value="bookingUrl(store.accountSlug)" readonly class="h-8 w-full rounded-ctl border border-line-control bg-surface-subtle px-2 text-[13px] text-ink-600" />
                  <button type="button" class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] text-ink-600 hover:border-line-controlHover" @click="copy(bookingUrl(store.accountSlug))">
                    {{ t('Copy', 'Copiar') }}
                  </button>
                </div>
              </div>

              <div v-if="store.accountSlug" data-test="booking-embed-card" class="rounded-card border border-line bg-surface p-4 shadow-card">
                <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Embed on your website', 'Insertar en tu web') }}</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                  {{ t(
                    'Paste this where the booking form should appear. The script carries the visitor\'s campaign (Google, Meta) into the widget, so paid bookings can be told apart from the rest.',
                    'Pega esto donde deba aparecer el formulario de reserva. El script lleva la campaña del visitante (Google, Meta) al widget, para poder distinguir las reservas de pago del resto.',
                  ) }}
                </p>
                <div class="mt-2 flex items-start gap-2">
                  <textarea
                    :value="embedSnippet(store.accountSlug)"
                    data-test="booking-embed-snippet"
                    readonly
                    rows="2"
                    class="w-full resize-none rounded-ctl border border-line-control bg-surface-subtle px-2 py-1.5 font-mono text-[12px] leading-relaxed text-ink-600"
                  />
                  <button type="button" class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] text-ink-600 hover:border-line-controlHover" @click="copy(embedSnippet(store.accountSlug))">
                    {{ t('Copy', 'Copiar') }}
                  </button>
                </div>
                <p class="mt-2 text-[12px] text-ink-muted2">
                  {{ t(
                    'Already embedded the widget by hand? Adding just the script tag is enough -- it upgrades an iframe that is already on the page.',
                    '¿Ya insertaste el widget a mano? Basta con añadir la etiqueta script -- actualiza un iframe que ya esté en la página.',
                  ) }}
                </p>
              </div>

              <div class="rounded-card border border-line bg-surface p-4 shadow-card">
                <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Booking notifications', 'Notificaciones de reserva') }}</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ t('Get pinged as soon as a patient books online -- by email, WhatsApp, or both.', 'Recibe un aviso en cuanto un paciente reserve online -- por correo, WhatsApp, o ambos.') }}</p>
                <div class="mt-3 space-y-3">
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">{{ t('Notify email', 'Correo de notificación') }}</label>
                    <input
                      v-model="notifyEmail"
                      type="email"
                      placeholder="you@clinic.com"
                      class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">{{ t('Notify WhatsApp number', 'Número de WhatsApp de notificación') }}</label>
                    <input
                      v-model="notifyWhatsapp"
                      type="text"
                      placeholder="+34600000000"
                      class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                    />
                    <p class="mt-1 text-[11.5px] text-ink-faint">
                      {{
                        t(
                          "In E.164 format. WhatsApp only delivers a free-form message like this one within 24h of that number last messaging your clinic's WhatsApp number -- send it a message occasionally to keep notifications flowing, or set a staff notification template in Settings → WhatsApp to send outside that window too.",
                          'En formato E.164. WhatsApp solo entrega un mensaje de texto libre como este dentro de las 24h posteriores a que ese número le escribiera por última vez al WhatsApp de tu clínica -- envíale un mensaje de vez en cuando para que sigan llegando las notificaciones, o configura una plantilla de aviso al personal en Ajustes → WhatsApp para enviarlas también fuera de esa ventana.',
                        )
                      }}
                    </p>
                  </div>
                </div>
              </div>
              <div class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="booking-types-note">
                <p class="text-[13.5px] font-[560] text-ink-700">{{ t('What can be booked', 'Qué se puede reservar') }}</p>
                <p class="mt-1 text-[12.5px] leading-snug text-ink-muted2">
                  {{ t('Whether a type is booked online, who may book it, how far ahead and whether it is paid when booking are set on each appointment type\'s own page.', 'Si un tipo se reserva online, quién puede reservarlo, con cuánta antelación y si se paga al reservar se decide en la página de cada tipo de cita.') }}
                </p>
                <ul v-if="types.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                  <li v-for="at in types" :key="at.id">
                    <NuxtLink
                      :to="`/settings/appointment-types/${at.id}#online`"
                      data-cy="booking-type-link"
                      class="inline-flex min-h-[32px] items-center gap-1.5 rounded-pill border border-line-control px-2.5 text-[12.5px] font-semibold hover:bg-surface-subtle"
                      :class="at.online_booking_enabled ? 'text-ink-700' : 'text-ink-faint'"
                    >
                      {{ at.name }}
                      <span class="font-normal">· {{ at.online_booking_enabled ? t('online', 'online') : t('not online', 'no online') }}</span>
                    </NuxtLink>
                  </li>
                </ul>
                <NuxtLink v-else to="/settings/appointment-types" class="mt-2 inline-block text-[12.5px] font-medium text-brand-text hover:underline">{{ t('Create an appointment type', 'Crea un tipo de cita') }}</NuxtLink>
              </div>
            </template>
          </div>

          <!-- Clinics & Hours -->
          <div v-else-if="activeTab === 'hours'" class="mt-4 space-y-2">
            <div v-for="c in bookingClinics" :key="c.id" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="booking-clinic" :data-clinic-id="c.id">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="text-[13.5px] font-[560] text-ink-700">{{ c.name }}</span>
                <label class="flex items-center gap-2.5 text-[13px] text-ink-600">
                  <SettingsToggle :model-value="c.online_booking_enabled" :disabled="savingClinicId === c.id" data-cy="booking-clinic-toggle" @update:model-value="setBookingEnabled(c, $event)" />
                  {{ t('Online booking', 'Reserva online') }}
                </label>
              </div>
              <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
                <dl class="grid grid-cols-[48px_1fr] gap-x-2 gap-y-0.5 text-[12.5px]" data-cy="booking-clinic-hours">
                  <template v-for="d in hoursLines(c)" :key="d.key">
                    <dt class="text-ink-muted2">{{ d.label }}</dt>
                    <dd :class="d.text ? 'text-ink-700' : 'text-ink-faint'">{{ d.text ?? t('Closed', 'Cerrado') }}</dd>
                  </template>
                </dl>
                <NuxtLink :to="`/settings/clinics/${c.id}#horario`" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" data-cy="booking-clinic-edit-hours">
                  {{ t('Edit hours in the clinic', 'Editar el horario en la sede') }}
                </NuxtLink>
              </div>
            </div>
            <p v-if="bookingClinics.length === 0" class="px-4 py-6 text-center text-[13px] text-ink-faint">{{ t('No clinics yet.', 'Todavía no hay clínicas.') }}</p>
            <p v-if="hoursError" class="mt-2 text-[12.5px] text-danger-text">{{ hoursError }}</p>
          </div>

          <!-- Discount Codes -->
          <div v-else-if="activeTab === 'discounts'" class="mt-4">
            <div class="divide-y divide-line-row rounded-card border border-line bg-surface shadow-card">
              <div v-for="c in codes" :key="c.id" class="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div>
                  <span class="font-mono font-semibold text-ink-700">{{ c.code }}</span>
                  <span class="ml-2 text-ink-muted2">
                    {{ c.percent_off ? t(`${c.percent_off}% off`, `${c.percent_off}% de descuento`) : '' }}{{ c.percent_off && c.amount_off_cents ? ' + ' : '' }}{{ c.amount_off_cents ? t(`${formatEur(c.amount_off_cents)} off`, `${formatEur(c.amount_off_cents)} de descuento`) : '' }}
                  </span>
                  <span class="ml-2 text-[11.5px] text-ink-faint">
                    {{ t(`${c.times_used}${c.max_uses ? `/${c.max_uses}` : ''} used${c.expires_at ? ` · expires ${new Date(c.expires_at).toLocaleDateString()}` : ''}`, `${c.times_used}${c.max_uses ? `/${c.max_uses}` : ''} usos${c.expires_at ? ` · caduca ${new Date(c.expires_at).toLocaleDateString()}` : ''}`) }}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <SettingsToggle :model-value="c.active" @update:model-value="toggleCodeActive(c)" />
                  <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeCode(c.id)">✕</button>
                </div>
              </div>
              <p v-if="codes.length === 0" class="px-4 py-6 text-center text-[13px] text-ink-faint">{{ t('No discount codes yet.', 'Todavía no hay códigos de descuento.') }}</p>
            </div>

            <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addCode">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Code', 'Código') }}</label>
                <input v-model="newCode" type="text" required placeholder="WELCOME10" class="mt-1 h-8 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13px] uppercase text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('% off', '% de descuento') }}</label>
                <input v-model="newPercentOff" type="number" min="1" max="100" class="mt-1 h-8 w-20 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('€ off', '€ de descuento') }}</label>
                <input v-model="newAmountOff" type="number" min="0" step="0.01" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Expires', 'Caduca') }}</label>
                <input v-model="newExpiresAt" type="date" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Max uses', 'Usos máximos') }}</label>
                <input v-model="newMaxUses" type="number" min="1" :placeholder="t('Unlimited', 'Ilimitados')" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
              <UiBtn variant="primary" type="submit" :disabled="addingCode">{{ addingCode ? t('Adding…', 'Añadiendo…') : t('Add Code', 'Añadir código') }}</UiBtn>
            </form>
            <p v-if="codeError" class="mt-2 text-[12.5px] text-danger-text">{{ codeError }}</p>
          </div>

          <!-- Layout -->
          <div v-else-if="activeTab === 'layout'" class="mt-4 space-y-3">
            <SettingsFieldRow :label="t('Hide business logo', 'Ocultar el logotipo del negocio')" :helper="t('Hide your clinic logo on the standalone booking page.', 'Oculta el logotipo de tu clínica en la página de reserva independiente.')">
              <SettingsToggle v-model="hideLogo" />
            </SettingsFieldRow>
            <SettingsFieldRow :label="t('Practitioner display order', 'Orden de visualización de profesionales')" align="top">
              <div class="space-y-1.5 text-[13px] text-ink-600">
                <label class="flex items-center gap-2"><input v-model="practitionerOrder" type="radio" value="default" class="text-brand focus:ring-brand" /> {{ t('Default', 'Por defecto') }}</label>
                <label class="flex items-center gap-2"><input v-model="practitionerOrder" type="radio" value="alphabetical" class="text-brand focus:ring-brand" /> {{ t('Alphabetical', 'Alfabético') }}</label>
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow :label="t('Primary color', 'Color primario')" align="top">
              <div class="flex items-center gap-2">
                <input v-model="primaryColor" type="color" class="h-8 w-14 rounded-ctl border border-line-control" />
                <input v-model="primaryColor" type="text" placeholder="#4C6FEB" class="h-8 w-28 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow :label="t('Secondary color', 'Color secundario')" align="top">
              <div class="flex items-center gap-2">
                <input v-model="secondaryColor" type="color" class="h-8 w-14 rounded-ctl border border-line-control" />
                <input v-model="secondaryColor" type="text" placeholder="#EEF1FF" class="h-8 w-28 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow label="Background color" helper="The page itself is always light -- it never follows a visitor's dark-mode setting. Use this to blend it with whatever site embeds it." align="top">
              <div class="flex items-center gap-2">
                <input v-model="backgroundColor" type="color" class="h-8 w-14 rounded-ctl border border-line-control" />
                <input v-model="backgroundColor" type="text" placeholder="#F7F8FA" class="h-8 w-28 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
            </SettingsFieldRow>
          </div>

          <!-- Language Overrides -->
          <div v-else-if="activeTab === 'language'" class="mt-4">
            <p class="text-[12.5px] text-ink-muted2">{{ t("Override the public booking page's own text, per string.", 'Sobrescribe el propio texto de la página pública de reserva, por cadena.') }}</p>
            <div class="mt-3 divide-y divide-line-row rounded-card border border-line bg-surface shadow-card">
              <div v-for="s in OVERRIDABLE_STRINGS" :key="s.key" class="grid grid-cols-2 gap-4 px-4 py-2.5">
                <p class="self-center text-[13px] text-ink-muted2">{{ s.default }}</p>
                <input
                  :value="textOverrides[s.key] ?? ''"
                  type="text"
                  :placeholder="s.default"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                  @change="textOverrides = { ...textOverrides, [s.key]: ($event.target as HTMLInputElement).value }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
