<script setup lang="ts">
import type { Tables, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const config = useRuntimeConfig()

const tabs = [
  { key: 'general', label: 'General' },
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
const hideLogo = ref(false)
const practitionerOrder = ref<'default' | 'alphabetical'>('default')
const textOverrides = ref<Record<string, string>>({})

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

async function loadAccountSettings() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'online_booking_max_days_ahead, online_booking_gtm_id, online_booking_referral_url, online_booking_primary_color, online_booking_secondary_color, online_booking_hide_logo, online_booking_practitioner_order, online_booking_text_overrides',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  maxDaysAhead.value = data?.online_booking_max_days_ahead ?? 90
  gtmId.value = data?.online_booking_gtm_id ?? ''
  referralUrl.value = data?.online_booking_referral_url ?? ''
  primaryColor.value = data?.online_booking_primary_color ?? ''
  secondaryColor.value = data?.online_booking_secondary_color ?? ''
  hideLogo.value = data?.online_booking_hide_logo ?? false
  practitionerOrder.value = (data?.online_booking_practitioner_order as 'default' | 'alphabetical') ?? 'default'
  textOverrides.value = (data?.online_booking_text_overrides as Record<string, string>) ?? {}
  loading.value = false
}
onMounted(loadAccountSettings)

async function saveAccountSettings() {
  saving.value = true
  saved.value = false
  const update: TablesUpdate<'accounts'> = {
    online_booking_max_days_ahead: maxDaysAhead.value,
    online_booking_gtm_id: gtmId.value.trim() || null,
    online_booking_referral_url: referralUrl.value.trim() || null,
    online_booking_primary_color: primaryColor.value.trim() || null,
    online_booking_secondary_color: secondaryColor.value.trim() || null,
    online_booking_hide_logo: hideLogo.value,
    online_booking_practitioner_order: practitionerOrder.value,
    online_booking_text_overrides: textOverrides.value,
  }
  await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  saved.value = true
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
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            Configure how patients book appointments online. Per-clinic business hours and the enable/disable switch
            still live in <NuxtLink to="/settings/clinics#online-booking" class="text-brand-text hover:underline">Settings → Clinics → Online Booking Hours</NuxtLink>.
          </p>

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
            </template>
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

          <p v-if="saved" class="mt-3 text-[12.5px] text-success-text">Saved.</p>
        </div>
      </div>
    </div>
  </div>
</template>
