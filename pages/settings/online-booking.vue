<script setup lang="ts">
import type { Tables, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const config = useRuntimeConfig()

const tabs = [
  { key: 'general', label: 'General' },
  { key: 'hours', label: 'Clinics & Hours' },
  { key: 'entities', label: 'Bookable Entities' },
  { key: 'discounts', label: 'Discount Codes' },
  { key: 'layout', label: 'Layout' },
  { key: 'language', label: 'Language Overrides' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('general')

// --- account-wide settings (General / Layout / Language) ---
const maxDaysAhead = ref(90)
const gtmId = ref('')
const referralUrl = ref('')
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
      'online_booking_max_days_ahead, online_booking_gtm_id, online_booking_referral_url, online_booking_primary_color, online_booking_secondary_color, online_booking_background_color, online_booking_hide_logo, online_booking_practitioner_order, online_booking_text_overrides, online_booking_notify_email, online_booking_notify_whatsapp',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  maxDaysAhead.value = data?.online_booking_max_days_ahead ?? 90
  gtmId.value = data?.online_booking_gtm_id ?? ''
  referralUrl.value = data?.online_booking_referral_url ?? ''
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

async function saveAccountSettings() {
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    online_booking_max_days_ahead: maxDaysAhead.value,
    online_booking_gtm_id: gtmId.value.trim() || null,
    online_booking_referral_url: referralUrl.value.trim() || null,
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
  showToast('Saved')
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

// --- Clinics & Hours: per-clinic enable toggle + business hours ---
// business_hours narrowed away from Supabase's recursive Json type here --
// it blows up Vue's template type-checker (TS2589) when combined with v-for.
type BookingClinic = Omit<Tables<'clinics'>, 'business_hours'> & { business_hours: Record<string, [string, string][]> }
type Windows = [string, string][]
const WEEKDAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const bookingClinics = ref<BookingClinic[]>([])
const openClinicId = ref<string | null>(null)
const editHours = ref<Record<string, Windows>>({})
const editEnabled = ref(false)
const savingHours = ref(false)
const hoursError = ref('')

async function loadBookingClinics() {
  const { data } = await supabase.from('clinics').select('*').order('name')
  bookingClinics.value = (data as unknown as BookingClinic[]) ?? []
}
onMounted(loadBookingClinics)

function openBookingEditor(c: BookingClinic) {
  openClinicId.value = openClinicId.value === c.id ? null : c.id
  if (openClinicId.value === c.id) {
    editEnabled.value = c.online_booking_enabled
    const hours = (c.business_hours as Record<string, Windows>) ?? {}
    editHours.value = Object.fromEntries(WEEKDAYS.map((d) => [d.key, hours[d.key] ? hours[d.key].map((w) => [...w] as [string, string]) : []]))
  }
}

function addWindow(day: string) {
  editHours.value[day].push(['09:00', '17:00'])
}
function removeWindow(day: string, i: number) {
  editHours.value[day].splice(i, 1)
}

async function saveBooking(clinicId: string) {
  savingHours.value = true
  const { error: updateError } = await supabase
    .from('clinics')
    .update({ online_booking_enabled: editEnabled.value, business_hours: editHours.value })
    .eq('id', clinicId)
  savingHours.value = false
  if (!updateError) {
    await loadBookingClinics()
  } else {
    hoursError.value = updateError.message
  }
}

// --- Bookable Entities: eligibility / bypass / max-days / deposit per type ---
const types = ref<Tables<'appointment_types'>[]>([])
const openTypeId = ref<string | null>(null)

async function loadTypes() {
  const { data } = await supabase.from('appointment_types').select('*').order('name')
  types.value = data ?? []
}
onMounted(loadTypes)

function toggleType(id: string) {
  openTypeId.value = openTypeId.value === id ? null : id
}

async function updateType(type: Tables<'appointment_types'>, patch: TablesUpdate<'appointment_types'>) {
  Object.assign(type, patch)
  await supabase.from('appointment_types').update(patch).eq('id', type.id)
}

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
    <PageHeader title="Online Booking Settings">
      <UiBtn v-if="activeTab === 'general' || activeTab === 'layout' || activeTab === 'language'" variant="primary" :disabled="saving || loading" @click="saveAccountSettings">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">Configure how patients book appointments online.</p>

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
            <div v-if="loading" class="text-[13px] text-ink-faint">Loading…</div>
            <template v-else>
              <SettingsFieldRow label="Maximum future booking time" helper="How far ahead patients can book online. Overridable per appointment type below.">
                <div class="flex items-center gap-2">
                  <input v-model.number="maxDaysAhead" type="number" min="1" class="h-8 w-20 rounded-ctl border border-line-control bg-surface px-2 text-center text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
                  <span class="text-[13px] text-ink-muted2">days</span>
                </div>
              </SettingsFieldRow>

              <SettingsFieldRow label="Google Tag Manager" helper="Injected on the public booking page for conversion tracking.">
                <input v-model="gtmId" type="text" placeholder="GTM-XXXXXXX" class="h-8 w-40 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </SettingsFieldRow>

              <SettingsFieldRow label="Patient referral URL" helper="Where a referred-patient link redirects to, if you track referrals separately.">
                <input v-model="referralUrl" type="text" placeholder="https://mysite.com/referral" class="h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </SettingsFieldRow>

              <div v-if="store.accountSlug" class="rounded-card border border-line bg-surface p-4 shadow-card">
                <p class="text-[13.5px] font-[560] text-ink-700">Public booking link</p>
                <div class="mt-2 flex items-center gap-2">
                  <input :value="bookingUrl(store.accountSlug)" readonly class="h-8 w-full rounded-ctl border border-line-control bg-surface-subtle px-2 text-[13px] text-ink-600" />
                  <button type="button" class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] text-ink-600 hover:border-line-controlHover" @click="copy(bookingUrl(store.accountSlug))">
                    Copy
                  </button>
                </div>
              </div>

              <div class="rounded-card border border-line bg-surface p-4 shadow-card">
                <p class="text-[13.5px] font-[560] text-ink-700">Booking notifications</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">Get pinged as soon as a patient books online -- by email, WhatsApp, or both.</p>
                <div class="mt-3 space-y-3">
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">Notify email</label>
                    <input
                      v-model="notifyEmail"
                      type="email"
                      placeholder="you@clinic.com"
                      class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">Notify WhatsApp number</label>
                    <input
                      v-model="notifyWhatsapp"
                      type="text"
                      placeholder="+34600000000"
                      class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                    />
                    <p class="mt-1 text-[11.5px] text-ink-faint">
                      In E.164 format. WhatsApp only delivers a free-form message like this one within 24h of that
                      number last messaging your clinic's WhatsApp number -- send it a message occasionally to keep
                      notifications flowing.
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Clinics & Hours -->
          <div v-else-if="activeTab === 'hours'" class="mt-4 space-y-2">
            <div v-for="c in bookingClinics" :key="c.id" class="rounded-card border border-line bg-surface shadow-card">
              <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="openBookingEditor(c)">
                <span class="text-[13.5px] font-[560] text-ink-700">{{ c.name }}</span>
                <UiPill :tone="c.online_booking_enabled ? 'success' : 'neutral'">{{ c.online_booking_enabled ? 'Enabled' : 'Disabled' }}</UiPill>
              </button>

              <div v-if="openClinicId === c.id" class="border-t border-line-divider p-4">
                <label class="flex items-center gap-2.5 text-[13px] text-ink-600">
                  <SettingsToggle v-model="editEnabled" />
                  Enable online booking for this clinic
                </label>

                <div class="mt-4 space-y-2">
                  <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">Business hours</p>
                  <div v-for="d in WEEKDAYS" :key="d.key" class="flex items-start gap-3 text-[13px]">
                    <span class="w-10 pt-1.5 text-ink-muted2">{{ d.label }}</span>
                    <div class="flex-1 space-y-1.5">
                      <p v-if="editHours[d.key].length === 0" class="pt-1.5 text-ink-faint">Closed</p>
                      <div v-for="(w, i) in editHours[d.key]" :key="i" class="flex items-center gap-2">
                        <input v-model="w[0]" type="time" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                        <span class="text-ink-faint">–</span>
                        <input v-model="w[1]" type="time" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                        <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeWindow(d.key, i)">✕</button>
                      </div>
                      <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="addWindow(d.key)">+ Add hours</button>
                    </div>
                  </div>
                </div>

                <UiBtn variant="primary" class="mt-4" :disabled="savingHours" @click="saveBooking(c.id)">
                  {{ savingHours ? 'Saving…' : 'Save' }}
                </UiBtn>
              </div>
            </div>
            <p v-if="bookingClinics.length === 0" class="px-4 py-6 text-center text-[13px] text-ink-faint">No clinics yet.</p>
            <p v-if="hoursError" class="mt-2 text-[12.5px] text-danger-text">{{ hoursError }}</p>
          </div>

          <!-- Bookable Entities -->
          <div v-else-if="activeTab === 'entities'" class="mt-4">
            <p class="text-[12.5px] text-ink-muted2">
              On/off and "require online payment" for each type still live in
              <NuxtLink to="/settings/appointment-types" class="text-brand-text hover:underline">Settings → Appointment Types</NuxtLink> — these are the deeper booking rules for types already enabled there.
            </p>
            <div class="mt-3 divide-y divide-line-row rounded-card border border-line bg-surface shadow-card">
              <div v-for="t in types" :key="t.id">
                <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="toggleType(t.id)">
                  <span class="text-[13.5px] font-[560] text-ink-700">{{ t.name }}</span>
                  <span class="text-[12px] text-ink-faint">{{ openTypeId === t.id ? 'Hide' : 'Configure' }}</span>
                </button>
                <div v-if="openTypeId === t.id" class="space-y-3 border-t border-line-divider bg-surface-subtle p-4">
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">Bookable by</label>
                    <select
                      :value="t.online_bookable_by"
                      class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
                      @change="updateType(t, { online_bookable_by: ($event.target as HTMLSelectElement).value })"
                    >
                      <option value="all">All patients</option>
                      <option value="new_patients">New patients only</option>
                      <option value="existing_patients">Existing patients only</option>
                    </select>
                  </div>
                  <label class="flex items-center gap-2 text-[13px] text-ink-600">
                    <SettingsToggle :model-value="t.online_bypass_practitioner" @update:model-value="(v) => updateType(t, { online_bypass_practitioner: v })" />
                    Bypass practitioner selection (show any available)
                  </label>
                  <div>
                    <label class="block text-[12px] font-medium text-ink-muted">Max days ahead override</label>
                    <input
                      :value="t.online_max_days_ahead ?? ''"
                      type="number"
                      min="1"
                      placeholder="Use account default"
                      class="mt-1 h-8 w-40 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                      @change="updateType(t, { online_max_days_ahead: ($event.target as HTMLInputElement).value ? parseInt(($event.target as HTMLInputElement).value, 10) : null })"
                    />
                  </div>
                  <div v-if="t.online_payment_required">
                    <label class="block text-[12px] font-medium text-ink-muted">Deposit amount (€)</label>
                    <input
                      :value="t.online_deposit_cents != null ? (t.online_deposit_cents / 100).toFixed(2) : ''"
                      type="number"
                      min="0"
                      step="0.01"
                      :placeholder="`Full price (€${(t.default_price_cents / 100).toFixed(2)})`"
                      class="mt-1 h-8 w-40 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none"
                      @change="updateType(t, { online_deposit_cents: ($event.target as HTMLInputElement).value ? Math.round(parseFloat(($event.target as HTMLInputElement).value) * 100) : null })"
                    />
                  </div>
                </div>
              </div>
              <p v-if="types.length === 0" class="px-4 py-6 text-center text-[13px] text-ink-faint">No appointment types yet.</p>
            </div>
          </div>

          <!-- Discount Codes -->
          <div v-else-if="activeTab === 'discounts'" class="mt-4">
            <div class="divide-y divide-line-row rounded-card border border-line bg-surface shadow-card">
              <div v-for="c in codes" :key="c.id" class="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div>
                  <span class="font-mono font-semibold text-ink-700">{{ c.code }}</span>
                  <span class="ml-2 text-ink-muted2">
                    {{ c.percent_off ? `${c.percent_off}% off` : '' }}{{ c.percent_off && c.amount_off_cents ? ' + ' : '' }}{{ c.amount_off_cents ? `€${(c.amount_off_cents / 100).toFixed(2)} off` : '' }}
                  </span>
                  <span class="ml-2 text-[11.5px] text-ink-faint">
                    {{ c.times_used }}{{ c.max_uses ? `/${c.max_uses}` : '' }} used{{ c.expires_at ? ` · expires ${new Date(c.expires_at).toLocaleDateString()}` : '' }}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <SettingsToggle :model-value="c.active" @update:model-value="toggleCodeActive(c)" />
                  <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeCode(c.id)">✕</button>
                </div>
              </div>
              <p v-if="codes.length === 0" class="px-4 py-6 text-center text-[13px] text-ink-faint">No discount codes yet.</p>
            </div>

            <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addCode">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Code</label>
                <input v-model="newCode" type="text" required placeholder="WELCOME10" class="mt-1 h-8 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13px] uppercase text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">% off</label>
                <input v-model="newPercentOff" type="number" min="1" max="100" class="mt-1 h-8 w-20 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">€ off</label>
                <input v-model="newAmountOff" type="number" min="0" step="0.01" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Expires</label>
                <input v-model="newExpiresAt" type="date" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Max uses</label>
                <input v-model="newMaxUses" type="number" min="1" placeholder="Unlimited" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
              <UiBtn variant="primary" type="submit" :disabled="addingCode">{{ addingCode ? 'Adding…' : 'Add Code' }}</UiBtn>
            </form>
            <p v-if="codeError" class="mt-2 text-[12.5px] text-danger-text">{{ codeError }}</p>
          </div>

          <!-- Layout -->
          <div v-else-if="activeTab === 'layout'" class="mt-4 space-y-3">
            <SettingsFieldRow label="Hide business logo" helper="Hide your clinic logo on the standalone booking page.">
              <SettingsToggle v-model="hideLogo" />
            </SettingsFieldRow>
            <SettingsFieldRow label="Practitioner display order" align="top">
              <div class="space-y-1.5 text-[13px] text-ink-600">
                <label class="flex items-center gap-2"><input v-model="practitionerOrder" type="radio" value="default" class="text-brand focus:ring-brand" /> Default</label>
                <label class="flex items-center gap-2"><input v-model="practitionerOrder" type="radio" value="alphabetical" class="text-brand focus:ring-brand" /> Alphabetical</label>
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow label="Primary color" align="top">
              <div class="flex items-center gap-2">
                <input v-model="primaryColor" type="color" class="h-8 w-14 rounded-ctl border border-line-control" />
                <input v-model="primaryColor" type="text" placeholder="#4C6FEB" class="h-8 w-28 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none" />
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow label="Secondary color" align="top">
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
            <p class="text-[12.5px] text-ink-muted2">Override the public booking page's own text, per string.</p>
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
