<script setup lang="ts">
import { formatLongDate, formatTime } from '~/utils/billing'
import { formatPhoneDisplay } from '~/utils/phone'
import type { Tables } from '~/types/database.types'

// The conversation with this patient, as a conversation.
//
// It was a list of rows with a status pill on the right, ordered newest
// first -- which is a log, not a thread. Reading a log means reconstructing
// who said what to whom, backwards, and the one thing staff come here to do
// is read the exchange.
//
// So: oldest at the top, inbound on the left, outbound on the right, and
// the delivery state drawn rather than spelled -- one tick sent, two
// delivered, two tinted read. A pill saying "Delivered" occupies the same
// room as the message and says less.
//
// Failure is the exception and stays spelled out, because "it did not
// arrive" is not something to encode in a glyph someone has to learn.
const props = withDefaults(
  defineProps<{ patientId: string; firstName?: string; preferredLanguage?: string; canContact?: boolean }>(),
  { canContact: true },
)

interface MessageRow {
  id: string
  direction: string
  purpose: string | null
  template_name: string | null
  status: string
  error_code: string | null
  error_message: string | null
  body_preview: string | null
  created_at: string
  /** Which way the message went out. Email rows join the same thread. */
  channel: 'whatsapp' | 'email'
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const messages = ref<MessageRow[]>([])
const loading = ref(true)
const newMessageOpen = ref(false)
const retryTemplate = ref<string | null>(null)

const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)

async function load() {
  loading.value = true
  const [{ data }, { data: emails }, { data: numbers }] = await Promise.all([
    supabase
      .from('whatsapp_messages')
      .select('id, direction, purpose, template_name, status, error_code, error_message, body_preview, created_at')
      .eq('patient_id', props.patientId)
      // Oldest first. A thread reads forwards; the old list read backwards.
      .order('created_at'),
    // Email belongs in the same thread. A message that failed on WhatsApp
    // and went by email instead is one conversation, not two, and an email
    // recorded nowhere visible is indistinguishable from one never sent.
    supabase
      .from('email_messages')
      .select('id, recipient_email, subject, sent_at, delivered_at, bounced_at, failed_at, failure_reason, first_opened_at')
      .eq('patient_id', props.patientId)
      .order('sent_at'),
    supabase.from('patient_contact_numbers').select('*').eq('patient_id', props.patientId).order('created_at').limit(1),
  ])

  const whatsapp: MessageRow[] = (data ?? []).map((m) => ({ ...m, channel: 'whatsapp' as const }))
  const emailRows: MessageRow[] = (emails ?? []).map((e) => ({
    id: e.id,
    direction: 'outbound',
    purpose: null,
    template_name: null,
    // Mapped onto the same five states the ticks already speak, so email
    // does not need a second vocabulary for the same four facts.
    status: e.failed_at || e.bounced_at ? 'failed' : e.first_opened_at ? 'read' : e.delivered_at ? 'delivered' : 'sent',
    error_code: null,
    error_message: e.failure_reason ?? (e.bounced_at ? t('The address bounced.', 'La dirección rebotó.') : null),
    body_preview: e.subject,
    created_at: e.sent_at ?? new Date().toISOString(),
    channel: 'email' as const,
  }))
  messages.value = [...whatsapp, ...emailRows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  primaryNumber.value = numbers?.[0] ?? null
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

const phone = computed(() =>
  primaryNumber.value ? formatPhoneDisplay(primaryNumber.value.number, primaryNumber.value.country_code) : null,
)

const isInbound = (m: MessageRow) => m.direction === 'inbound' || m.status === 'received'

/** Messages grouped under one date heading each, the way a thread reads. */
const days = computed(() => {
  const out: { key: string; label: string; items: MessageRow[] }[] = []
  for (const m of messages.value) {
    const key = m.created_at.slice(0, 10)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(m)
    else out.push({ key, label: formatLongDate(m.created_at), items: [m] })
  }
  return out
})

// Sent / Delivered / Read are drawn, not written: one tick, two ticks, two
// tinted ticks. The label stays in the title and the screen-reader text, so
// the state is never carried by the glyph alone.
const DELIVERY_LABELS = computed<Record<string, string>>(() => ({
  sent: t('Sent', 'Enviado'),
  delivered: t('Delivered', 'Entregado'),
  read: t('Read', 'Leído'),
  failed: t('Failed', 'Fallido'),
  received: t('Received', 'Recibido'),
  would_send: t('Not sent — test mode', 'No enviado — modo prueba'),
}))
function deliveryLabel(m: MessageRow) {
  return DELIVERY_LABELS.value[m.status] ?? m.status
}
const tickCount = (status: string) => (status === 'sent' ? 1 : status === 'delivered' || status === 'read' ? 2 : 0)

/**
 * What a screen reader hears when the newest outbound message changes
 * state, since the change itself is only drawn. Announced politely: it is
 * useful, not urgent.
 */
const latestDelivery = computed(() => {
  const outbound = messages.value.filter((m) => !isInbound(m))
  const last = outbound[outbound.length - 1]
  if (!last) return ''
  return `${t('Last message', 'Último mensaje')}: ${deliveryLabel(last)}`
})

/**
 * What the bubble is titled, or null for no title at all.
 *
 * An outbound message used to fall back to the word "Sent", which sat
 * directly above a tick pair saying the thing had been READ -- two claims
 * about the same message, one of them stale. The delivery state is the
 * ticks' job. This line only names the template, when there is one to name.
 */
function titleFor(m: MessageRow): string | null {
  if (isInbound(m)) return t('From the patient', 'Del paciente')
  return m.template_name ?? m.purpose ?? null
}

// Sending again rather than "Retry": whatsapp_messages keeps the template
// NAME but not the variables it was filled with, and the send endpoint
// needs both. A one-click retry would have to invent them, so this opens
// the composer on the same template and lets staff confirm what it says.
function sendAgain(m: MessageRow) {
  retryTemplate.value = m.template_name
  newMessageOpen.value = true
}

// The reason this endpoint exists: WhatsApp refuses for reasons that have
// nothing to do with the patient being reachable -- the 24-hour window
// closed, the template is unapproved, the number is not opted in -- and the
// clinic still has an email address and something that needs saying.
const emailingId = ref<string | null>(null)
const { showToast } = useToast()
async function sendByEmailInstead(m: MessageRow) {
  if (emailingId.value) return
  emailingId.value = m.id
  try {
    const res = await useStaffFetch<{ to: string }>(`/api/patients/${props.patientId}/send-email`, {
      method: 'POST',
      body: { body: m.body_preview ?? '', subject: t('A message from your clinic', 'Un mensaje de tu clínica') },
    })
    showToast(`${t('Sent by email to', 'Enviado por correo a')} ${res.to}`)
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not send the email.', 'No se pudo enviar el correo.'), 'error')
  } finally {
    emailingId.value = null
  }
}

const templates = ref<{ name: string; language: string }[]>([])
const templatesError = ref(false)
async function loadTemplates() {
  try {
    const res = await useStaffFetch<{ templates: { name: string; language: string }[] }>('/api/whatsapp/templates')
    templates.value = res.templates ?? []
  } catch {
    // WhatsApp not configured, or Meta unreachable. The thread still works;
    // the side panel simply cannot list what can be sent.
    templatesError.value = true
  }
}
onMounted(loadTemplates)
</script>

<template>
  <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <section aria-labelledby="comms-thread" class="rounded-card border border-line bg-surface shadow-card">
        <!-- Which channel, which number, and whose it is. A thread with no
             header is a thread you have to take on trust. -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider px-4 py-3">
          <div class="min-w-0">
            <h2 id="comms-thread" class="flex items-center gap-2 text-[13.5px] font-semibold text-ink-700">
              <span aria-hidden="true" class="flex h-5 w-5 items-center justify-center rounded-ctlSm bg-success-bg text-[9px] font-bold text-success-text">WA</span>
              WhatsApp
            </h2>
            <p class="mt-0.5 text-[12px] text-ink-muted2">
              <template v-if="phone">
                <span class="font-mono">{{ phone }}</span> ·
                {{ t("the patient's own number", 'el número del propio paciente') }}
              </template>
              <template v-else>{{ t('No number on file for this patient.', 'Este paciente no tiene número registrado.') }}</template>
            </p>
          </div>
          <UiBtn v-if="canContact" variant="primary" size="sm" @click="retryTemplate = null; newMessageOpen = true">
            {{ t('New message', 'Nuevo mensaje') }}
          </UiBtn>
        </div>

        <p v-if="!canContact" class="border-b border-line-divider bg-danger-bg px-4 py-2 text-[12px] text-danger-text">
          {{ t('This patient is marked "do not contact" — new messages are disabled.', 'Este paciente está marcado como "no contactar": los nuevos mensajes están deshabilitados.') }}
        </p>

        <!-- Delivery states are drawn, so the change is also announced. -->
        <p aria-live="polite" class="sr-only">{{ latestDelivery }}</p>

        <div v-if="loading" class="space-y-3 p-4">
          <UiSkeleton v-for="i in 3" :key="i" class="h-12 rounded-card" :class="i % 2 ? 'w-2/3' : 'ml-auto w-1/2'" />
        </div>

        <p v-else-if="messages.length === 0" class="p-8 text-center text-[13px] text-ink-faint">
          {{ t('Nothing has been sent to this patient yet.', 'Aún no se ha enviado nada a este paciente.') }}
        </p>

        <div v-else class="max-h-[560px] overflow-y-auto px-4 py-3">
          <template v-for="day in days" :key="day.key">
            <p class="my-2 text-center text-[11px] uppercase tracking-[.04em] text-ink-faint">{{ day.label }}</p>

            <div
              v-for="m in day.items"
              :key="m.id"
              class="mb-2 flex"
              :class="isInbound(m) ? 'justify-start' : 'justify-end'"
            >
              <div
                class="max-w-[82%] rounded-card px-3 py-2"
                :class="
                  m.status === 'failed'
                    ? 'border border-danger-border bg-danger-bg'
                    : isInbound(m)
                      ? 'border border-line-control bg-surface'
                      : 'bg-brand-tint'
                "
              >
                <p class="flex items-center gap-1.5 text-[11px]" :class="m.status === 'failed' ? 'text-danger-text' : 'text-ink-muted2'">
                  <span
                    v-if="m.channel === 'email'"
                    class="rounded-ctlSm bg-chip-bg px-1 py-px text-[9px] font-bold uppercase text-chip-text"
                  >{{ t('Email', 'Correo') }}</span>
                  <span v-if="titleFor(m)">{{ titleFor(m) }}</span>
                </p>
                <p v-if="m.body_preview" class="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink-900">{{ m.body_preview }}</p>

                <!-- Failure is spelled out. A glyph for "it did not arrive"
                     is a glyph someone has to be taught. -->
                <template v-if="m.status === 'failed'">
                  <p class="mt-1 text-[12px] text-danger-text">
                    {{ m.error_message ?? t('The message could not be delivered.', 'No se pudo entregar el mensaje.') }}
                    <span v-if="m.error_code" class="font-mono text-[11px]"> ({{ m.error_code }})</span>
                  </p>
                  <div v-if="canContact" class="mt-1.5 flex flex-wrap gap-3">
                    <button
                      v-if="m.template_name"
                      type="button"
                      class="text-[12px] font-semibold text-danger-text underline outline-none focus-visible:shadow-focusDanger"
                      @click="sendAgain(m)"
                    >
                      {{ t('Send again', 'Enviar de nuevo') }}
                    </button>
                    <button
                      v-if="m.channel === 'whatsapp' && m.body_preview"
                      type="button"
                      :disabled="emailingId === m.id"
                      class="text-[12px] font-semibold text-danger-text underline outline-none focus-visible:shadow-focusDanger disabled:no-underline disabled:opacity-60"
                      @click="sendByEmailInstead(m)"
                    >
                      {{ emailingId === m.id ? t('Sending…', 'Enviando…') : t('Send by email instead', 'Enviar por correo') }}
                    </button>
                  </div>
                </template>

                <p class="mt-1 flex items-center justify-end gap-1 text-[11px] text-ink-faint">
                  <span>{{ formatTime(m.created_at) }}</span>
                  <template v-if="!isInbound(m) && tickCount(m.status) > 0">
                    <span class="sr-only">{{ deliveryLabel(m) }}</span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 12"
                      class="h-3 w-4"
                      :class="m.status === 'read' ? 'text-brand' : 'text-ink-faint'"
                      :title="deliveryLabel(m)"
                    >
                      <path d="M2 6.5 5 9.5 11 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      <path v-if="tickCount(m.status) === 2" d="M8.5 6.5 11.5 9.5 17.5 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </template>
                  <span v-else-if="!isInbound(m)" class="text-ink-faint">{{ deliveryLabel(m) }}</span>
                </p>
              </div>
            </div>
          </template>
        </div>

        <!-- Where a reply goes. Staff assume a reply comes back to them
             personally; it does not, and finding that out by missing one is
             the expensive way. -->
        <p class="border-t border-line-divider px-4 py-2.5 text-[11.5px] text-ink-muted2">
          {{ t('Replies arrive in the clinic inbox, not here.', 'Las respuestas llegan a la bandeja de la clínica, no aquí.') }}
          <NuxtLink to="/inbox" class="font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus">
            {{ t('Open inbox', 'Abrir bandeja') }}
          </NuxtLink>
        </p>
      </section>
    </div>

    <div class="flex w-full shrink-0 flex-col gap-4 xl:w-[320px]">
      <section aria-labelledby="comms-where" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 id="comms-where" class="text-[13.5px] font-semibold text-ink-700">{{ t('Where this goes', 'A dónde va') }}</h2>
        <dl class="mt-3 space-y-2.5">
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Channel', 'Canal') }}</dt>
            <dd class="mt-0.5 text-[13px] text-ink-700">WhatsApp</dd>
          </div>
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Number', 'Número') }}</dt>
            <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ phone ?? t('None on file', 'Sin registrar') }}</dd>
          </div>
          <div>
            <dt class="text-[11.5px] text-ink-muted2">{{ t('Sent from', 'Enviado desde') }}</dt>
            <dd class="mt-0.5 text-[13px] text-ink-700">{{ store.accountName || t('This clinic', 'Esta clínica') }}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="comms-templates" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 id="comms-templates" class="text-[13.5px] font-semibold text-ink-700">{{ t('Templates', 'Plantillas') }}</h2>
        <p v-if="templatesError" class="mt-2 text-[12px] text-ink-faint">
          {{ t('WhatsApp is not connected, so templates cannot be listed.', 'WhatsApp no está conectado, no se pueden listar las plantillas.') }}
        </p>
        <p v-else-if="templates.length === 0" class="mt-2 text-[12px] text-ink-faint">
          {{ t('No approved templates yet.', 'Aún no hay plantillas aprobadas.') }}
        </p>
        <ul v-else class="mt-2.5 space-y-1.5">
          <li v-for="tpl in templates" :key="`${tpl.name}-${tpl.language}`" class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 truncate font-mono text-[12px] text-ink-700">{{ tpl.name }}</span>
            <span class="shrink-0 text-[11px] uppercase text-ink-faint">{{ tpl.language }}</span>
          </li>
        </ul>
      </section>
    </div>

    <SendWhatsAppModal
      v-if="newMessageOpen"
      :patient-id="patientId"
      :patient-first-name="firstName"
      :patient-preferred-language="preferredLanguage"
      :default-template-name="retryTemplate ?? undefined"
      @close="newMessageOpen = false"
      @sent="newMessageOpen = false; load()"
    />
  </div>
</template>
