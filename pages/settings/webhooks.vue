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
  { value: 'appointment.checked_in', label: 'Appointment checked in' },
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
  <div class="flex h-full flex-col">
    <PageHeader title="Webhooks" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            Subscribe an endpoint to receive an HTTP POST whenever a subscribed event happens. Each request carries
            an <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5 text-[12px]">X-QuiroFlow-Event</code> header
            and a body of <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5 text-[12px]">{{ '{ event, created_at, data }' }}</code>.
            Verify it came from us by recomputing an HMAC-SHA256 of the raw body with your webhook's secret and
            comparing it to the <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5 text-[12px]">X-QuiroFlow-Signature</code> header (hex-encoded).
          </p>

          <div class="mt-6 rounded-card border border-line bg-surface shadow-card">
            <div class="border-b border-line-divider p-4">
              <h3 class="text-[13.5px] font-[560] text-ink-700">Endpoints</h3>
            </div>
            <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
            <div v-else-if="webhooks.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No webhooks yet.</div>
            <ul v-else class="divide-y divide-line-row">
              <li v-for="w in webhooks" :key="w.id" class="p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-[13.5px] font-[560] text-ink-700">{{ w.url }}</p>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <UiPill v-for="e in w.events" :key="e" tone="brand">{{ eventLabel(e) }}</UiPill>
                    </div>
                    <p class="mt-2 text-[12px] text-ink-muted2">
                      Secret:
                      <code v-if="revealedSecret === w.id" class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">{{ w.secret }}</code>
                      <code v-else class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">{{ '•'.repeat(24) }}</code>
                      <button type="button" class="ml-1 text-brand-text hover:text-brand-hover" @click="revealedSecret = revealedSecret === w.id ? null : w.id">
                        {{ revealedSecret === w.id ? 'Hide' : 'Reveal' }}
                      </button>
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-3 text-[12px]">
                    <label class="flex items-center gap-2 text-ink-muted2">
                      <SettingsToggle :model-value="w.enabled" @update:model-value="toggleEnabled(w)" />
                      Enabled
                    </label>
                    <button type="button" class="font-medium text-ink-muted2 hover:text-ink-600" @click="toggleDeliveries(w)">
                      {{ expandedWebhook === w.id ? 'Hide log' : 'View log' }}
                    </button>
                    <button type="button" class="font-medium text-danger-text hover:text-danger-text/80" @click="removeWebhook(w)">Delete</button>
                  </div>
                </div>

                <div v-if="expandedWebhook === w.id" class="mt-3 rounded-ctl border border-line-divider bg-surface-subtle p-3">
                  <div v-if="loadingDeliveries" class="text-[12px] text-ink-faint">Loading…</div>
                  <div v-else-if="(deliveriesByWebhook[w.id]?.length ?? 0) === 0" class="text-[12px] text-ink-faint">
                    No deliveries yet.
                  </div>
                  <ul v-else class="space-y-1.5">
                    <li v-for="d in deliveriesByWebhook[w.id]" :key="d.id" class="text-[12px] text-ink-muted2">
                      <span class="font-medium text-ink-700">{{ d.event_type }}</span>
                      &middot; {{ new Date(d.created_at).toLocaleString() }}
                      <span v-if="d.request_id" class="text-ink-faint">&middot; request #{{ d.request_id }}</span>
                    </li>
                  </ul>
                </div>
              </li>
            </ul>
          </div>

          <form class="mt-4 space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addWebhook">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Endpoint URL</label>
              <input
                v-model="url"
                type="url"
                required
                placeholder="https://example.com/webhooks/quiroflow"
                class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Events</label>
              <div class="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <label v-for="e in EVENT_OPTIONS" :key="e.value" class="flex items-center gap-1.5 text-[12.5px] text-ink-600">
                  <input
                    v-model="selectedEvents"
                    type="checkbox"
                    :value="e.value"
                    class="rounded border-line-control text-brand focus:ring-brand/30"
                  />
                  {{ e.label }}
                </label>
              </div>
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Webhook' }}</UiBtn>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
