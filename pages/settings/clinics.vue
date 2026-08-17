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

function bookingUrl(slug: string) {
  return `${window.location.origin}/book/${slug}`
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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Clinics</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Address</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="store.clinics.length === 0">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">No clinics yet.</td>
          </tr>
          <tr v-for="c in store.clinics" :key="c.id">
            <td class="px-4 py-2.5 text-gray-900">{{ c.name }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ c.address ?? 'N/A' }}</td>
            <td class="px-4 py-2.5 text-right">
              <button type="button" class="text-gray-400 hover:text-red-600" @click="removeClinic(c.id)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addClinic">
      <div>
        <label class="block text-sm font-medium text-gray-700">Name</label>
        <input v-model="name" type="text" required placeholder="Valencia" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Address</label>
        <input v-model="address" type="text" class="mt-1 w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Clinic' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>

    <h2 class="mt-8 text-lg font-semibold text-gray-900">Online Booking</h2>
    <p class="mt-1 text-sm text-gray-500">Let patients book their own appointments from a public page or an iframe embedded on your website.</p>

    <div class="mt-3 space-y-2">
      <div v-for="c in bookingClinics" :key="c.id" class="rounded-lg border border-gray-200 bg-white">
        <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="openBookingEditor(c)">
          <span class="text-sm font-medium text-gray-900">{{ c.name }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="c.online_booking_enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'"
          >
            {{ c.online_booking_enabled ? 'Enabled' : 'Disabled' }}
          </span>
        </button>

        <div v-if="openClinicId === c.id" class="border-t border-gray-100 p-4">
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="editEnabled" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Enable online booking for this clinic
          </label>

          <div class="mt-4 space-y-2">
            <p class="text-xs font-medium uppercase tracking-wide text-gray-400">Business hours</p>
            <div v-for="d in WEEKDAYS" :key="d.key" class="flex items-start gap-3 text-sm">
              <span class="w-10 pt-1.5 text-gray-500">{{ d.label }}</span>
              <div class="flex-1 space-y-1.5">
                <p v-if="editHours[d.key].length === 0" class="pt-1.5 text-gray-400">Closed</p>
                <div v-for="(w, i) in editHours[d.key]" :key="i" class="flex items-center gap-2">
                  <input v-model="w[0]" type="time" class="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                  <span class="text-gray-400">–</span>
                  <input v-model="w[1]" type="time" class="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                  <button type="button" class="text-gray-400 hover:text-red-600" @click="removeWindow(d.key, i)">✕</button>
                </div>
                <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="addWindow(d.key)">+ Add hours</button>
              </div>
            </div>
          </div>

          <button
            type="button"
            :disabled="savingHours"
            class="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            @click="saveBooking(c.id)"
          >
            {{ savingHours ? 'Saving…' : 'Save' }}
          </button>

          <div v-if="c.online_booking_enabled && store.accountSlug" class="mt-6 border-t border-gray-100 pt-4">
            <p class="text-xs font-medium uppercase tracking-wide text-gray-400">Public booking link</p>
            <div class="mt-1 flex items-center gap-2">
              <input :value="bookingUrl(store.accountSlug)" readonly class="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm text-gray-600" />
              <button type="button" class="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="copy(bookingUrl(store.accountSlug))">
                Copy
              </button>
            </div>

            <p class="mt-3 text-xs font-medium uppercase tracking-wide text-gray-400">Embed on your website</p>
            <div class="mt-1 flex items-start gap-2">
              <textarea readonly rows="5" class="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-600">{{ embedSnippet(store.accountSlug) }}</textarea>
              <button type="button" class="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="copy(embedSnippet(store.accountSlug))">
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
