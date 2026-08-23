<script setup lang="ts">
const props = defineProps<{ accountId: string }>()

interface Message {
  id: string
  patient_id: string | null
  phone_number: string | null
  direction: string
  status: string
  body_preview: string | null
  template_name: string | null
  media_type: string | null
  channel: string
  created_at: string
}
interface Conversation {
  key: string
  patientId: string | null
  phoneNumber: string | null
  name: string
  lastMessage: Message
  unread: boolean
}

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { register: registerForPush } = usePushNotifications()
onMounted(registerForPush)

const messages = ref<Message[]>([])
const patientNames = ref<Record<string, string>>({})
const loading = ref(true)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, patient_id, phone_number, direction, status, body_preview, template_name, media_type, channel, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  messages.value = data ?? []

  const patientIds = [...new Set(messages.value.map((m) => m.patient_id).filter((id): id is string => !!id))]
  if (patientIds.length > 0) {
    const { data: patients } = await supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
    const names: Record<string, string> = {}
    for (const p of patients ?? []) names[p.id] = `${p.first_name} ${p.last_name ?? ''}`.trim()
    patientNames.value = names
  }
  loading.value = false
}
onMounted(load)

const conversations = computed<Conversation[]>(() => {
  const byKey = new Map<string, Message[]>()
  for (const m of messages.value) {
    const key = m.patient_id ?? m.phone_number ?? 'unknown'
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(m)
  }
  const list: Conversation[] = []
  for (const [key, msgs] of byKey) {
    const last = msgs[0]
    list.push({
      key,
      patientId: last.patient_id,
      phoneNumber: last.phone_number,
      name: (last.patient_id && patientNames.value[last.patient_id]) || last.phone_number || 'Unknown',
      lastMessage: last,
      unread: last.direction === 'inbound',
    })
  }
  return list.sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at))
})

const selectedKey = ref<string | null>(null)
const selected = computed(() => conversations.value.find((c) => c.key === selectedKey.value) ?? null)
const thread = computed(() =>
  selectedKey.value ? messages.value.filter((m) => (m.patient_id ?? m.phone_number ?? 'unknown') === selectedKey.value).slice().reverse() : [],
)

const within24h = computed(() => {
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound').at(-1)
  if (!lastInbound) return false
  return Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 60 * 60 * 1000
})

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')

async function sendText() {
  if (!composerText.value.trim() || !selected.value) return
  sendError.value = ''
  sending.value = true
  try {
    await authedFetch('/api/whatsapp/inbox-send', {
      method: 'POST',
      body: {
        patientId: selected.value.patientId ?? undefined,
        phoneNumber: selected.value.patientId ? undefined : selected.value.phoneNumber,
        text: composerText.value.trim(),
      },
    })
    composerText.value = ''
    await load()
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? 'Failed to send'
  } finally {
    sending.value = false
  }
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function previewText(m: Message) {
  if (m.media_type) return `📎 ${m.media_type}${m.body_preview ? ` — ${m.body_preview}` : ''}`
  if (m.template_name) return m.body_preview ?? `Template: ${m.template_name}`
  return m.body_preview ?? '—'
}

let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('mobile-inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, () => load())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, () => load())
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Conversation list -->
    <div v-if="!selectedKey" class="flex-1 overflow-y-auto">
      <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
      <p v-else-if="conversations.length === 0" class="p-6 text-center text-[13px] text-ink-faint">No conversations yet.</p>
      <button
        v-for="c in conversations"
        :key="c.key"
        type="button"
        class="flex w-full items-start gap-3 border-b border-line-row px-4 py-3 text-left active:bg-surface-subtle"
        @click="selectedKey = c.key"
      >
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand-text">
          {{ c.name.slice(0, 2).toUpperCase() }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="truncate text-[14px] font-[560]" :class="c.unread ? 'text-ink-900' : 'text-ink-700'">{{ c.name }}</p>
            <span class="shrink-0 text-[12px] text-ink-faint">{{ shortTime(c.lastMessage.created_at) }}</span>
          </div>
          <p class="truncate text-[13px]" :class="c.unread ? 'font-medium text-ink-800' : 'text-ink-muted2'">
            {{ c.lastMessage.direction === 'outbound' ? 'You: ' : '' }}{{ previewText(c.lastMessage) }}
          </p>
        </div>
        <span v-if="c.unread" class="mt-2 h-[9px] w-[9px] shrink-0 rounded-full bg-brand" />
      </button>
    </div>

    <!-- Thread -->
    <div v-else-if="selected" class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text" @click="selectedKey = null">&larr;</button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-[600] text-ink-900">{{ selected.name }}</p>
          <p v-if="selected.phoneNumber" class="truncate text-[12px] text-ink-muted2">{{ selected.phoneNumber }}</p>
        </div>
      </div>

      <div class="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <div v-for="m in thread" :key="m.id" class="flex" :class="m.direction === 'outbound' ? 'justify-end' : 'justify-start'">
          <div
            class="max-w-[80%] rounded-card px-3 py-2 shadow-card"
            :class="m.direction === 'outbound' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900'"
          >
            <p class="whitespace-pre-wrap text-[13.5px]">{{ previewText(m) }}</p>
            <p class="mt-1 text-right text-[10.5px]" :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'">{{ shortTime(m.created_at) }}</p>
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-line bg-surface p-3">
        <p v-if="sendError" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
        <p v-if="!within24h" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text">
          More than 24h since {{ selected.name }} last messaged — free-form replies are blocked by WhatsApp.
        </p>
        <div v-else class="flex items-end gap-2">
          <textarea
            v-model="composerText"
            rows="1"
            placeholder="Type a message…"
            class="max-h-24 min-h-11 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
            @keydown.enter.exact.prevent="sendText"
          />
          <UiBtn variant="primary" :disabled="sending || !composerText.trim()" @click="sendText">{{ sending ? '…' : 'Send' }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
