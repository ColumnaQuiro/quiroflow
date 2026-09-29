<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// Settings > Webhooks, now under Developers beside API & Tokens and gated
// the same way (developers_access): a webhook's secret and the stream of
// patient events it receives are the same kind of grant as a token.
// Delivery is a pg_net call from a trigger (0021_webhooks.sql); this page
// manages the endpoints and shows what was sent.

type Webhook = Tables<'webhooks'>
type Delivery = Tables<'webhook_deliveries'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const EVENT_GROUPS = computed(() => [
  {
    label: t('Patients', 'Pacientes'),
    events: [
      { value: 'patient.created', label: t('Created', 'Creado') },
      { value: 'patient.updated', label: t('Updated', 'Actualizado') },
      { value: 'patient.deleted', label: t('Deleted', 'Eliminado') },
    ],
  },
  {
    label: t('Appointments', 'Citas'),
    events: [
      { value: 'appointment.created', label: t('Created', 'Creada') },
      { value: 'appointment.updated', label: t('Updated', 'Actualizada') },
      { value: 'appointment.deleted', label: t('Deleted', 'Eliminada') },
      { value: 'appointment.checked_in', label: t('Checked in', 'Check-in') },
    ],
  },
  {
    label: t('Receipts', 'Recibos'),
    events: [{ value: 'invoice.paid', label: t('Paid', 'Pagado') }],
  },
])

function eventLabel(value: string) {
  for (const g of EVENT_GROUPS.value) {
    const e = g.events.find((x) => x.value === value)
    if (e) return `${g.label} · ${e.label.toLowerCase()}`
  }
  return value
}

const webhooks = ref<Webhook[]>([])
const loading = ref(true)

async function load() {
  const { data } = await supabase.from('webhooks').select('*').order('created_at', { ascending: false })
  webhooks.value = data ?? []
  loading.value = false
}
onMounted(load)

// One form, for adding and for changing an endpoint's events.
const editing = ref<'new' | string | null>(null)
const url = ref('')
const selectedEvents = ref<string[]>([])
const saving = ref(false)
const error = ref('')

function openNew() {
  editing.value = 'new'
  url.value = ''
  selectedEvents.value = []
  error.value = ''
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy="webhook-url"]')?.focus())
}
function openEdit(w: Webhook) {
  editing.value = w.id
  url.value = w.url
  selectedEvents.value = [...w.events]
  error.value = ''
}

async function save() {
  error.value = ''
  const target = url.value.trim()
  if (!/^https:\/\/\S+$/i.test(target)) {
    error.value = t('Enter the full https:// address of the endpoint.', 'Introduce la dirección https:// completa del endpoint.')
    return
  }
  if (selectedEvents.value.length === 0) {
    error.value = t('Choose at least one event.', 'Elige al menos un evento.')
    return
  }
  saving.value = true
  const { error: saveError } =
    editing.value === 'new'
      ? await supabase.from('webhooks').insert({ account_id: store.accountId!, url: target, events: selectedEvents.value, created_by: store.teamMember?.id ?? null })
      : await supabase.from('webhooks').update({ url: target, events: selectedEvents.value }).eq('id', editing.value!)
  saving.value = false
  if (saveError) {
    error.value = saveError.message
    return
  }
  editing.value = null
  await load()
}

async function toggleEnabled(w: Webhook) {
  const { error: updateError } = await supabase.from('webhooks').update({ enabled: !w.enabled }).eq('id', w.id)
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  w.enabled = !w.enabled
}

// Asked in an in-app dialog rather than confirm().
const deleting = ref<Webhook | null>(null)
async function confirmDelete() {
  const w = deleting.value
  if (!w) return
  const { error: deleteError } = await supabase.from('webhooks').delete().eq('id', w.id)
  if (deleteError) {
    showToast(deleteError.message, 'error')
    return
  }
  deleting.value = null
  await load()
}

const revealed = ref<string | null>(null)
const copiedId = ref<string | null>(null)
async function copySecret(w: Webhook) {
  await navigator.clipboard.writeText(w.secret)
  copiedId.value = w.id
}

const deliveries = ref<Record<string, Delivery[]>>({})
const openLog = ref<string | null>(null)
const openPayload = ref<string | null>(null)
async function toggleLog(w: Webhook) {
  if (openLog.value === w.id) {
    openLog.value = null
    return
  }
  openLog.value = w.id
  const { data } = await supabase.from('webhook_deliveries').select('*').eq('webhook_id', w.id).order('created_at', { ascending: false }).limit(20)
  deliveries.value[w.id] = data ?? []
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const verifyExample = `const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
if (expected !== req.headers['x-quiroflow-signature']) return res.status(401).end()`
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Webhooks', 'Webhooks')">
      <UiBtn variant="primary" data-cy="webhook-new" :disabled="editing === 'new'" @click="openNew">{{ t('Add endpoint', 'Añadir endpoint') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[900px] flex-1 flex-col gap-4" data-cy="webhooks-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('QuiroFlow sends a POST to your address the moment something happens here, so another system can react without asking every few minutes.', 'QuiroFlow envía un POST a tu dirección en cuanto pasa algo aquí, para que otro sistema pueda reaccionar sin preguntar cada pocos minutos.') }}
          </p>

          <!-- Adding, or changing an endpoint -->
          <form v-if="editing" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="webhook-form" @submit.prevent="save">
            <h2 class="px-[18px] pb-3 pt-4 text-[16px] font-bold text-ink-900">{{ editing === 'new' ? t('Add an endpoint', 'Añadir un endpoint') : t('Change endpoint', 'Cambiar endpoint') }}</h2>
            <div class="flex flex-col gap-4 border-t border-line-row px-[18px] pb-[18px] pt-3.5">
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Address', 'Dirección') }}
                <input v-model="url" type="url" data-cy="webhook-url" placeholder="https://example.com/webhooks/quiroflow" :class="[inputClass, 'font-mono text-[13px]']" />
              </label>
              <fieldset class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <legend class="mb-2 text-[13px] font-semibold text-ink-700">{{ t('Send when', 'Enviar cuando') }}</legend>
                <div v-for="g in EVENT_GROUPS" :key="g.label" class="flex flex-col gap-2">
                  <strong class="text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ g.label }}</strong>
                  <label v-for="e in g.events" :key="e.value" class="flex items-center gap-2 text-[13.5px] text-ink-700">
                    <input v-model="selectedEvents" type="checkbox" :value="e.value" :data-event="e.value" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand/30" />
                    {{ e.label }}
                  </label>
                </div>
              </fieldset>
              <p v-if="error" class="text-[13px] text-danger-text" data-cy="webhook-error">{{ error }}</p>
              <div class="flex gap-2">
                <UiBtn variant="primary" type="submit" data-cy="webhook-save" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : editing === 'new' ? t('Add endpoint', 'Añadir endpoint') : t('Save', 'Guardar') }}</UiBtn>
                <UiBtn @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
              </div>
            </div>
          </form>

          <div v-if="loading" class="flex flex-col gap-2 rounded-card border border-line bg-surface p-[18px]">
            <UiSkeleton class="h-4 w-72 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
          </div>
          <div v-else-if="webhooks.length === 0 && !editing" class="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center" data-cy="webhooks-empty">
            <p class="text-[14px] text-ink-700">{{ t('No endpoints yet.', 'Aún no hay endpoints.') }}</p>
            <UiBtn variant="primary" @click="openNew">{{ t('Add endpoint', 'Añadir endpoint') }}</UiBtn>
          </div>

          <section v-for="w in webhooks" :key="w.id" class="overflow-hidden rounded-card border border-line bg-surface" :aria-label="w.url" data-cy="webhook-card">
            <div class="flex items-start gap-4 px-[18px] py-4">
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <strong class="break-all font-mono text-[14px] font-semibold" :class="w.enabled ? 'text-ink-900' : 'text-ink-muted'">{{ w.url }}</strong>
                <div class="flex flex-wrap gap-1.5">
                  <UiPill v-for="e in w.events" :key="e" tone="brand">{{ eventLabel(e) }}</UiPill>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                data-cy="webhook-enabled"
                :aria-checked="w.enabled"
                :aria-label="t('Sending', 'Enviando')"
                class="relative h-[26px] w-11 shrink-0 rounded-full"
                :class="w.enabled ? 'bg-brand' : 'bg-line-control'"
                @click="toggleEnabled(w)"
              >
                <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="w.enabled ? 'left-[21px]' : 'left-[3px]'" />
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3">
              <span class="w-[110px] text-[13px] font-semibold text-ink-700">{{ t('Signing secret', 'Secreto de firma') }}</span>
              <code class="min-w-0 flex-1 break-all font-mono text-[13px] text-ink-muted" data-cy="webhook-secret">{{ revealed === w.id ? w.secret : '•'.repeat(32) }}</code>
              <UiBtn size="sm" @click="revealed = revealed === w.id ? null : w.id">{{ revealed === w.id ? t('Hide', 'Ocultar') : t('Reveal', 'Mostrar') }}</UiBtn>
              <UiBtn size="sm" @click="copySecret(w)">{{ copiedId === w.id ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}</UiBtn>
            </div>
            <div v-if="openLog === w.id" class="border-t border-line-row" data-cy="webhook-log">
              <p v-if="!deliveries[w.id]" class="px-[18px] py-3"><UiSkeleton class="h-3 w-48 rounded-ctlSm" /></p>
              <p v-else-if="deliveries[w.id]!.length === 0" class="px-[18px] py-4 text-[13px] text-ink-muted">{{ t('Nothing sent yet.', 'Aún no se ha enviado nada.') }}</p>
              <ul v-else>
                <li v-for="d in deliveries[w.id]" :key="d.id" class="border-b border-line-row last:border-b-0">
                  <button type="button" class="flex w-full items-center gap-3 px-[18px] py-2 text-left hover:bg-surface-subtle" @click="openPayload = openPayload === d.id ? null : d.id">
                    <span class="w-[150px] shrink-0 text-[13px] text-ink-muted">{{ new Date(d.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) }}</span>
                    <span class="flex-1 font-mono text-[12.5px] text-ink-900">{{ d.event_type }}</span>
                    <span v-if="d.request_id" class="font-mono text-[12px] text-ink-faint">#{{ d.request_id }}</span>
                  </button>
                  <pre v-if="openPayload === d.id" class="mx-[18px] mb-3 max-h-[280px] overflow-auto rounded-ctl bg-[rgb(21,23,30)] p-3 text-[12px] text-[rgb(236,238,243)]">{{ JSON.stringify(d.payload, null, 2) }}</pre>
                </li>
              </ul>
            </div>
            <div class="flex flex-wrap justify-end gap-2 border-t border-line-row px-[18px] py-3">
              <UiBtn size="sm" data-cy="webhook-log-toggle" @click="toggleLog(w)">{{ openLog === w.id ? t('Hide what was sent', 'Ocultar lo enviado') : t('What was sent', 'Lo enviado') }}</UiBtn>
              <UiBtn size="sm" data-cy="webhook-edit" @click="openEdit(w)">{{ t('Change', 'Cambiar') }}</UiBtn>
              <UiBtn size="sm" class="!border-danger-border !text-danger-text" data-cy="webhook-delete" @click="deleting = w">{{ t('Delete', 'Eliminar') }}</UiBtn>
            </div>
          </section>

          <details class="overflow-hidden rounded-card border border-line bg-surface">
            <summary class="cursor-pointer px-[18px] py-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle">{{ t('Checking a request came from QuiroFlow', 'Comprobar que una solicitud viene de QuiroFlow') }}</summary>
            <div class="flex flex-col gap-2.5 px-[18px] pb-4 text-[13px] leading-snug text-ink-700">
              <p>
                {{ t('Each POST carries', 'Cada POST lleva') }} <code class="font-mono text-[12px]">X-QuiroFlow-Event</code> {{ t('and', 'y') }}
                <code class="font-mono text-[12px]">X-QuiroFlow-Signature</code>:
                {{ t("an HMAC-SHA256 of the raw body with the endpoint's secret, in hex. The body is", 'un HMAC-SHA256 del cuerpo en bruto con el secreto del endpoint, en hexadecimal. El cuerpo es') }}
                <code class="font-mono text-[12px]">{{ '{ event, created_at, data }' }}</code>.
              </p>
              <pre class="overflow-x-auto rounded-ctl bg-[rgb(21,23,30)] p-3 text-[12px] text-[rgb(236,238,243)]"><code>{{ verifyExample }}</code></pre>
            </div>
          </details>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t('Delete this endpoint?', '¿Eliminar este endpoint?')"
      :confirm-label="t('Delete endpoint', 'Eliminar endpoint')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="break-all text-[14px] leading-snug text-ink-700">{{ t(`Nothing more is sent to ${deleting.url}, and its log goes with it.`, `No se envía nada más a ${deleting.url}, y su registro se elimina con él.`) }}</p>
    </UiConfirmDialog>
  </div>
</template>
