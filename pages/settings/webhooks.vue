<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type Webhook = Tables<'webhooks'>
type Delivery = Tables<'webhook_deliveries'>

const EVENT_OPTIONS = [
  { value: 'patient.created', label: 'Patient created' },
  { value: 'patient.updated', label: 'Patient updated' },
  { value: 'patient.deleted', label: 'Patient deleted' },
  { value: 'appointment.created', label: 'Appointment created' },
  { value: 'appointment.updated', label: 'Appointment updated' },
  { value: 'appointment.deleted', label: 'Appointment deleted' },
  { value: 'invoice.paid', label: 'Invoice paid' },
]

const supabase = useSupabaseClient()
const store = useAccountStore()

const webhooks = ref<Webhook[]>([])
const loading = ref(true)

const url = ref('')
const selectedEvents = ref<string[]>([])
const saving = ref(false)
const error = ref('')

const revealedSecret = ref<string | null>(null)
const deliveriesByWebhook = ref<Record<string, Delivery[]>>({})
const expandedWebhook = ref<string | null>(null)
const loadingDeliveries = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase.from('webhooks').select('*').order('created_at', { ascending: false })
  webhooks.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addWebhook() {
  error.value = ''
  if (!url.value.trim()) {
    error.value = 'Enter an endpoint URL.'
    return
  }
  if (selectedEvents.value.length === 0) {
    error.value = 'Select at least one event.'
    return
  }
  saving.value = true
  const { error: insertError } = await supabase.from('webhooks').insert({
    account_id: store.accountId!,
    url: url.value.trim(),
    events: selectedEvents.value,
    created_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  url.value = ''
  selectedEvents.value = []
  await load()
}

async function toggleEnabled(w: Webhook) {
  await supabase.from('webhooks').update({ enabled: !w.enabled }).eq('id', w.id)
  await load()
}

async function removeWebhook(w: Webhook) {
  if (!confirm(`Delete the webhook for ${w.url}?`)) return
  await supabase.from('webhooks').delete().eq('id', w.id)
  await load()
}

function eventLabel(value: string) {
  return EVENT_OPTIONS.find((e) => e.value === value)?.label ?? value
}

async function toggleDeliveries(w: Webhook) {
  if (expandedWebhook.value === w.id) {
    expandedWebhook.value = null
    return
  }
  expandedWebhook.value = w.id
  if (deliveriesByWebhook.value[w.id]) return
  loadingDeliveries.value = true
  const { data } = await supabase
    .from('webhook_deliveries')
    .select('*')
    .eq('webhook_id', w.id)
    .order('created_at', { ascending: false })
    .limit(20)
  deliveriesByWebhook.value[w.id] = data ?? []
  loadingDeliveries.value = false
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Webhooks</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      Register an endpoint to receive an HTTP POST whenever a subscribed event happens. Each request carries an
      <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">X-QuiroFlow-Event</code> header and a body of
      <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{ event, created_at, data }' }}</code>. Verify it came
      from us by recomputing an HMAC-SHA256 of the raw body with your webhook's secret and comparing it to the
      <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">X-QuiroFlow-Signature</code> header (hex-encoded).
    </p>

    <div class="mt-6 rounded-lg border border-gray-200 bg-white">
      <div class="border-b border-gray-100 p-4">
        <h3 class="text-sm font-semibold text-gray-900">Endpoints</h3>
      </div>
      <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
      <div v-else-if="webhooks.length === 0" class="p-8 text-center text-sm text-gray-400">No webhooks yet.</div>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="w in webhooks" :key="w.id" class="p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-gray-900">{{ w.url }}</p>
              <div class="mt-1 flex flex-wrap gap-1">
                <span v-for="e in w.events" :key="e" class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                  {{ eventLabel(e) }}
                </span>
              </div>
              <p class="mt-2 text-xs text-gray-500">
                Secret:
                <code v-if="revealedSecret === w.id" class="rounded bg-gray-100 px-1 py-0.5">{{ w.secret }}</code>
                <code v-else class="rounded bg-gray-100 px-1 py-0.5">{{ '•'.repeat(24) }}</code>
                <button type="button" class="ml-1 text-indigo-600 hover:text-indigo-700" @click="revealedSecret = revealedSecret === w.id ? null : w.id">
                  {{ revealedSecret === w.id ? 'Hide' : 'Reveal' }}
                </button>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5 text-gray-500">
                <input type="checkbox" :checked="w.enabled" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleEnabled(w)" />
                Enabled
              </label>
              <button type="button" class="font-medium text-gray-500 hover:text-gray-700" @click="toggleDeliveries(w)">
                {{ expandedWebhook === w.id ? 'Hide log' : 'View log' }}
              </button>
              <button type="button" class="font-medium text-red-600 hover:text-red-700" @click="removeWebhook(w)">Delete</button>
            </div>
          </div>

          <div v-if="expandedWebhook === w.id" class="mt-3 rounded-md border border-gray-100 bg-gray-50 p-3">
            <div v-if="loadingDeliveries" class="text-xs text-gray-400">Loading…</div>
            <div v-else-if="(deliveriesByWebhook[w.id]?.length ?? 0) === 0" class="text-xs text-gray-400">
              No deliveries yet.
            </div>
            <ul v-else class="space-y-1.5">
              <li v-for="d in deliveriesByWebhook[w.id]" :key="d.id" class="text-xs text-gray-600">
                <span class="font-medium text-gray-900">{{ d.event_type }}</span>
                &middot; {{ new Date(d.created_at).toLocaleString() }}
                <span v-if="d.request_id" class="text-gray-400">&middot; request #{{ d.request_id }}</span>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </div>

    <form class="mt-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="addWebhook">
      <div>
        <label class="block text-sm font-medium text-gray-700">Endpoint URL</label>
        <input
          v-model="url"
          type="url"
          required
          placeholder="https://example.com/webhooks/quiroflow"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Events</label>
        <div class="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <label v-for="e in EVENT_OPTIONS" :key="e.value" class="flex items-center gap-1.5 text-sm text-gray-700">
            <input
              v-model="selectedEvents"
              type="checkbox"
              :value="e.value"
              class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            {{ e.label }}
          </label>
        </div>
      </div>
      <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ saving ? 'Adding…' : 'Add Webhook' }}
      </button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </div>
</template>
