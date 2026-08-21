<script setup lang="ts">
const props = withDefaults(defineProps<{ patientId: string; firstName?: string; preferredLanguage?: string; canContact?: boolean }>(), { canContact: true })

interface MessageRow {
  id: string
  direction: string
  purpose: string | null
  template_name: string | null
  status: string
  error_message: string | null
  body_preview: string | null
  created_at: string
}

const supabase = useSupabaseClient()
const messages = ref<MessageRow[]>([])
const loading = ref(true)
const newMessageOpen = ref(false)

async function load() {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, purpose, template_name, status, error_message, body_preview, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  messages.value = data ?? []
  loading.value = false
}
onMounted(load)

// Every row today is a WhatsApp message -- Email/SMS aren't wired up as
// communication channels yet, so the filter only ever narrows within "All".
const channelFilter = ref<'all' | 'whatsapp'>('all')
const filteredMessages = computed(() => messages.value)

const statusTone: Record<string, 'brand' | 'success' | 'danger' | 'neutral'> = {
  sent: 'brand',
  delivered: 'brand',
  read: 'success',
  failed: 'danger',
  received: 'neutral',
}
const statusLabel: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  received: 'Received',
}

function titleFor(m: MessageRow) {
  if (m.direction === 'inbound') return 'Received message'
  return m.template_name ?? m.purpose ?? 'Message sent'
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between gap-3 border-b border-line-divider px-4 py-3">
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="rounded-pill px-2.5 py-1 text-[12px] font-medium"
          :class="channelFilter === 'all' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:bg-surface-subtle'"
          @click="channelFilter = 'all'"
        >
          All
        </button>
        <button
          type="button"
          class="rounded-pill px-2.5 py-1 text-[12px] font-medium"
          :class="channelFilter === 'whatsapp' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:bg-surface-subtle'"
          @click="channelFilter = 'whatsapp'"
        >
          WhatsApp
        </button>
      </div>
      <UiBtn v-if="canContact" variant="primary" size="sm" @click="newMessageOpen = true">New message</UiBtn>
    </div>
    <p v-if="!canContact" class="border-b border-line-divider bg-danger-bg px-4 py-2 text-[12px] text-danger-text">
      This patient is marked "do not contact" — new messages are disabled.
    </p>

    <div v-if="loading" class="p-8 text-center text-[13px] text-ink-faint">Loading…</div>
    <p v-else-if="filteredMessages.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No WhatsApp messages sent to this patient yet.</p>
    <ul v-else class="divide-y divide-line-row">
      <li v-for="m in filteredMessages" :key="m.id" class="flex items-center gap-3 px-4 py-3">
        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctlSm bg-success-bg text-[9.5px] font-bold text-success-text">WA</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[13px] font-medium text-ink-700">{{ titleFor(m) }}</p>
          <p v-if="m.body_preview" class="truncate text-[12px] text-ink-muted2">{{ m.body_preview }}</p>
          <p v-if="m.status === 'failed' && m.error_message" class="truncate text-[12px] text-danger-text">{{ m.error_message }}</p>
        </div>
        <div class="shrink-0 text-right">
          <UiPill :tone="statusTone[m.status] ?? 'neutral'">{{ statusLabel[m.status] ?? m.status }}</UiPill>
          <p class="mt-1 text-[11px] text-ink-faint">{{ new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</p>
        </div>
      </li>
    </ul>

    <SendWhatsAppModal
      v-if="newMessageOpen"
      :patient-id="patientId"
      :patient-first-name="firstName"
      :patient-preferred-language="preferredLanguage"
      @close="newMessageOpen = false"
      @sent="newMessageOpen = false; load()"
    />
  </div>
</template>
