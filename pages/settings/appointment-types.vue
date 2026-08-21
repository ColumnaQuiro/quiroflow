<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const STAGE_OPTIONS = [
  { value: '', label: 'Not classified' },
  { value: 'first_visit', label: 'First visit' },
  { value: 'first_visit_offer', label: 'First visit (offer)' },
  { value: 'report', label: 'Report / exam findings' },
  { value: 'revision', label: 'Revision / check-up' },
  { value: 'maintenance', label: 'Maintenance package' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'other', label: 'Other' },
]

const types = ref<Tables<'appointment_types'>[]>([])
const loading = ref(true)

const name = ref('')
const duration = ref('30')
const price = ref('')
const color = ref('#4C6FEB')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('appointment_types').select('*').order('name')
  types.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addType() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('appointment_types').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    duration_minutes: parseInt(duration.value, 10) || 30,
    default_price_cents: Math.round((parseFloat(price.value) || 0) * 100),
    color: color.value,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  duration.value = '30'
  price.value = ''
  await load()
}

async function removeType(id: string) {
  if (!confirm('Delete this appointment type?')) return
  await supabase.from('appointment_types').delete().eq('id', id)
  await load()
}

async function toggleBookable(type: Tables<'appointment_types'>) {
  const next = !type.online_booking_enabled
  type.online_booking_enabled = next
  await supabase.from('appointment_types').update({ online_booking_enabled: next }).eq('id', type.id)
}

async function updateStage(type: Tables<'appointment_types'>, stage: string) {
  type.stage = stage || null
  await supabase.from('appointment_types').update({ stage: stage || null }).eq('id', type.id)
}

async function updateName(type: Tables<'appointment_types'>, value: string) {
  const next = value.trim()
  if (!next || next === type.name) return
  type.name = next
  await supabase.from('appointment_types').update({ name: next }).eq('id', type.id)
}

async function updateDuration(type: Tables<'appointment_types'>, value: string) {
  const next = parseInt(value, 10) || type.duration_minutes
  type.duration_minutes = next
  await supabase.from('appointment_types').update({ duration_minutes: next }).eq('id', type.id)
}

async function updatePrice(type: Tables<'appointment_types'>, value: string) {
  const next = Math.round((parseFloat(value) || 0) * 100)
  type.default_price_cents = next
  await supabase.from('appointment_types').update({ default_price_cents: next }).eq('id', type.id)
}

async function updateColor(type: Tables<'appointment_types'>, value: string) {
  type.color = value
  await supabase.from('appointment_types').update({ color: value }).eq('id', type.id)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Appointment Types" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Visit types, durations, colors, and default price.</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Duration</th>
                  <th class="px-4 py-2">Default price</th>
                  <th class="px-4 py-2">Stage</th>
                  <th class="px-4 py-2">Online booking</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="6" class="px-4 py-6 text-center text-ink-faint">Loading…</td>
                </tr>
                <tr v-else-if="types.length === 0">
                  <td colspan="6" class="px-4 py-6 text-center text-ink-faint">No appointment types yet.</td>
                </tr>
                <tr v-for="t in types" :key="t.id">
                  <td class="px-4 py-2.5 text-ink-700">
                    <div class="flex items-center gap-2">
                      <input
                        type="color"
                        :value="t.color"
                        class="h-6 w-6 shrink-0 rounded border border-line-control p-0"
                        @change="updateColor(t, ($event.target as HTMLInputElement).value)"
                      />
                      <input
                        :value="t.name"
                        type="text"
                        class="w-full min-w-0 rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updateName(t, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-ink-muted2">
                    <div class="flex items-center gap-1">
                      <input
                        :value="t.duration_minutes"
                        type="number"
                        min="5"
                        step="5"
                        class="w-16 rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updateDuration(t, ($event.target as HTMLInputElement).value)"
                      />
                      min
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-ink-muted2">
                    <div class="flex items-center gap-1">
                      €
                      <input
                        :value="(t.default_price_cents / 100).toFixed(2)"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-20 rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updatePrice(t, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-2.5">
                    <select
                      :value="t.stage ?? ''"
                      class="rounded-ctlSm border border-line-control bg-surface py-1 pl-2 pr-6 text-[12.5px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                      @change="updateStage(t, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="s in STAGE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
                    </select>
                  </td>
                  <td class="px-4 py-2.5">
                    <label class="flex items-center gap-2 text-ink-600">
                      <SettingsToggle :model-value="t.online_booking_enabled" @update:model-value="toggleBookable(t)" />
                      Bookable
                    </label>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeType(t.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-[12px] text-ink-faint">
            "Stage" lets the Statistics report count first visits, reports, revisions, etc. — pick whichever bucket
            each type maps to for you.
          </p>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addType">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Name</label>
              <input v-model="name" type="text" required placeholder="Ajuste Quiropractico" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Duration (min)</label>
              <input v-model="duration" type="number" min="5" step="5" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Default price (€)</label>
              <input v-model="price" type="number" step="0.01" min="0" class="mt-1 h-8 w-28 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Color</label>
              <input v-model="color" type="color" class="mt-1 h-8 w-14 rounded-ctl border border-line-control" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Type' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
