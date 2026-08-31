<script setup lang="ts">
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
}

async function onLogoUploaded() {
  store.reset()
  await store.load()
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
                  <th class="px-4 py-2">Logo</th>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Address</th>
                  <th class="px-4 py-2">Calendar slot</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="store.clinics.length === 0">
                  <td colspan="5" class="px-4 py-6 text-center text-ink-faint">No clinics yet.</td>
                </tr>
                <tr v-for="c in store.clinics" :key="c.id">
                  <td class="px-4 py-2.5">
                    <SettingsClinicLogoUpload :clinic-id="c.id" :logo-storage-path="c.logo_storage_path" @uploaded="onLogoUploaded" />
                  </td>
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

          <p class="mt-6 text-[12.5px] text-ink-faint">
            Online booking (enable/hours per clinic, booking window, layout, discount codes) lives in
            <NuxtLink to="/settings/online-booking" class="text-brand-text hover:underline">Settings → Online Booking</NuxtLink>.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
