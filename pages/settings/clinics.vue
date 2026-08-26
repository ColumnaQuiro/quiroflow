<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const name = ref('')
const address = ref('')
const saving = ref(false)
const error = ref('')

async function addClinic() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('clinics').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    address: address.value.trim() || null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  address.value = ''
  store.reset()
  await store.load()
  await loadBookingClinics()
}

const SLOT_DURATION_OPTIONS = [10, 15, 20, 30, 60]

async function updateSlotDuration(clinicId: string, minutes: number) {
  await supabase.from('clinics').update({ slot_duration_minutes: minutes }).eq('id', clinicId)
  const clinic = store.clinics.find((c) => c.id === clinicId)
  if (clinic) clinic.slot_duration_minutes = minutes
}

// Name/address on an existing clinic previously had no edit path at all --
// the form below only ever created new clinics, and the table's only
// per-row inputs were slot duration and delete.
async function updateClinicName(clinicId: string, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return
  await supabase.from('clinics').update({ name: trimmed }).eq('id', clinicId)
  const clinic = store.clinics.find((c) => c.id === clinicId)
  if (clinic) clinic.name = trimmed
}
async function updateClinicAddress(clinicId: string, value: string) {
  const trimmed = value.trim() || null
  await supabase.from('clinics').update({ address: trimmed }).eq('id', clinicId)
  const clinic = store.clinics.find((c) => c.id === clinicId)
  if (clinic) clinic.address = trimmed
}

async function removeClinic(id: string) {
  if (!confirm('Delete this clinic?')) return
  await supabase.from('clinics').delete().eq('id', id)
  store.reset()
  await store.load()
  await loadBookingClinics()
}

// --- Online booking ---
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
    error.value = updateError.message
  }
}

const config = useRuntimeConfig()

function bookingUrl(slug: string) {
  const domain = config.public.appDomain
  if (!domain) return `${window.location.origin}/book/${slug}`
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${slug}.${domain}${port}/`
}
function embedSnippet(slug: string) {
  const url = bookingUrl(slug)
  return `<iframe id="quiroflow-booking" src="${url}" style="width:100%;border:0;min-height:900px" title="Reservar cita"></iframe>
<script>
window.addEventListener('message', function (e) {
  if (e.data && e.data.source === 'quiroflow-booking') {
    document.getElementById('quiroflow-booking').style.height = e.data.height + 'px'
  }
})
<\/script>`
}
function copy(text: string) {
  navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Clinics" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Locations your practice operates from.</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Address</th>
                  <th class="px-4 py-2">Calendar slot</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="store.clinics.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">No clinics yet.</td>
                </tr>
                <tr v-for="c in store.clinics" :key="c.id">
                  <td class="px-4 py-2.5">
                    <input
                      :value="c.name"
                      type="text"
                      class="w-full min-w-[120px] rounded-ctlSm border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-ink-700 hover:border-line-control focus:border-brand focus:bg-surface focus:outline-none focus:ring-1 focus:ring-brand/20"
                      @change="updateClinicName(c.id, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td class="px-4 py-2.5">
                    <input
                      :value="c.address ?? ''"
                      type="text"
                      placeholder="Add address…"
                      class="w-full min-w-[180px] rounded-ctlSm border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-ink-muted2 placeholder:text-ink-faint2 hover:border-line-control focus:border-brand focus:bg-surface focus:text-ink-700 focus:outline-none focus:ring-1 focus:ring-brand/20"
                      @change="updateClinicAddress(c.id, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td class="px-4 py-2.5">
                    <select
                      :value="c.slot_duration_minutes"
                      class="rounded-ctlSm border border-line-control bg-surface py-1 pl-2 pr-6 text-[12.5px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                      @change="updateSlotDuration(c.id, Number(($event.target as HTMLSelectElement).value))"
                    >
                      <option v-for="m in SLOT_DURATION_OPTIONS" :key="m" :value="m">{{ m }} min</option>
                    </select>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeClinic(c.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-[12px] text-ink-faint">
            "Calendar slot" sets how finely the Calendar's time grid is divided (e.g. 15 min shows 9:00, 9:15, 9:30…).
          </p>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addClinic">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Name</label>
              <input v-model="name" type="text" required placeholder="Valencia" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Address</label>
              <input v-model="address" type="text" class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Clinic' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>

          <h2 id="online-booking" class="mt-8 text-[15px] font-[620] text-ink-900">Online Booking</h2>
          <p class="mt-1 text-[13px] text-ink-muted2">Let patients book their own appointments from a public page or an iframe embedded on your website.</p>

          <div class="mt-3 space-y-2">
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

                <div v-if="c.online_booking_enabled && store.accountSlug" class="mt-6 border-t border-line-divider pt-4">
                  <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">Public booking link</p>
                  <div class="mt-1 flex items-center gap-2">
                    <input :value="bookingUrl(store.accountSlug)" readonly class="h-8 w-full rounded-ctl border border-line-control bg-surface-subtle px-2 text-[13px] text-ink-600" />
                    <button type="button" class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] text-ink-600 hover:border-line-controlHover" @click="copy(bookingUrl(store.accountSlug))">
                      Copy
                    </button>
                  </div>

                  <p class="mt-3 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">Embed on your website</p>
                  <div class="mt-1 flex items-start gap-2">
                    <textarea readonly rows="5" class="w-full rounded-ctl border border-line-control bg-surface-subtle px-2 py-1.5 font-mono text-[12px] text-ink-600">{{ embedSnippet(store.accountSlug) }}</textarea>
                    <button type="button" class="shrink-0 rounded-ctl border border-line-control px-3 py-2 text-[12.5px] text-ink-600 hover:border-line-controlHover" @click="copy(embedSnippet(store.accountSlug))">
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
