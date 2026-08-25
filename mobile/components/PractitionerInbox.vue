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
  media_storage_path: string | null
  media_mime_type: string | null
  media_filename: string | null
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

const messages = ref<Message[]>([])
const patientNames = ref<Record<string, string>>({})
const loading = ref(true)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, patient_id, phone_number, direction, status, body_preview, template_name, media_type, media_storage_path, media_mime_type, media_filename, channel, created_at')
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

const mediaUrls = ref<Record<string, string>>({})
watch(thread, async (msgs) => {
  const paths = [...new Set(msgs.map((m) => m.media_storage_path).filter((p): p is string => !!p && !mediaUrls.value[p]))]
  if (paths.length === 0) return
  const results = await Promise.all(paths.map((p) => supabase.storage.from('whatsapp-media').createSignedUrl(p, 60 * 30)))
  const next = { ...mediaUrls.value }
  paths.forEach((p, i) => {
    const url = results[i].data?.signedUrl
    if (url) next[p] = url
  })
  mediaUrls.value = next
})

const within24h = computed(() => {
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound').at(-1)
  if (!lastInbound) return false
  return Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 60 * 60 * 1000
})

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')
const composerTextarea = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()

function insertReply(text: string) {
  const el = composerTextarea.value
  if (!el) {
    composerText.value += text
    return
  }
  const start = el.selectionStart ?? composerText.value.length
  const end = el.selectionEnd ?? composerText.value.length
  composerText.value = composerText.value.slice(0, start) + text + composerText.value.slice(end)
  nextTick(() => {
    el.focus()
    const cursor = start + text.length
    el.setSelectionRange(cursor, cursor)
  })
}

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

const MAX_MEDIA_BYTES = 16 * 1024 * 1024
function mediaKindForFile(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
async function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !selected.value) return
  if (file.size > MAX_MEDIA_BYTES) {
    sendError.value = 'File is too large (max 16 MB).'
    return
  }
  sendError.value = ''
  sending.value = true
  try {
    const base64 = await fileToBase64(file)
    await authedFetch('/api/whatsapp/inbox-send', {
      method: 'POST',
      body: {
        patientId: selected.value.patientId ?? undefined,
        phoneNumber: selected.value.patientId ? undefined : selected.value.phoneNumber,
        mediaBase64: base64,
        mediaMimeType: file.type,
        mediaFilename: file.name,
        mediaKind: mediaKindForFile(file),
      },
    })
    await load()
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? 'Failed to send'
  } finally {
    sending.value = false
    if (fileInput.value) fileInput.value.value = ''
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
            <img v-if="m.media_type === 'image' && m.media_storage_path && mediaUrls[m.media_storage_path]" :src="mediaUrls[m.media_storage_path]" class="max-w-full rounded-ctl" />
            <video v-else-if="m.media_type === 'video' && m.media_storage_path && mediaUrls[m.media_storage_path]" :src="mediaUrls[m.media_storage_path]" controls class="max-w-full rounded-ctl" />
            <audio v-else-if="m.media_type === 'audio' && m.media_storage_path && mediaUrls[m.media_storage_path]" :src="mediaUrls[m.media_storage_path]" controls class="max-w-full" />
            <a
              v-else-if="m.media_type === 'document' && m.media_storage_path && mediaUrls[m.media_storage_path]"
              :href="mediaUrls[m.media_storage_path]"
              target="_blank"
              class="flex items-center gap-2 text-[13px] underline"
              :class="m.direction === 'outbound' ? 'text-white' : 'text-brand-text'"
            >
              📄 {{ m.media_filename ?? 'Document' }}
            </a>
            <img
              v-else-if="m.media_type === 'sticker' && m.media_storage_path && mediaUrls[m.media_storage_path]"
              :src="mediaUrls[m.media_storage_path]"
              class="h-24 w-24"
            />
            <p v-else-if="m.media_type" class="text-[12.5px] italic opacity-70">Media unavailable</p>

            <p v-if="m.body_preview && m.media_type" class="mt-1 whitespace-pre-wrap text-[13.5px]">{{ m.body_preview }}</p>
            <p v-else-if="!m.media_type" class="whitespace-pre-wrap text-[13.5px]">{{ previewText(m) }}</p>
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
          <SavedRepliesPicker size="lg" @insert="insertReply" />
          <input ref="fileInput" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" class="hidden" @change="onFileChosen" />
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            @click="fileInput?.click()"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M11.5 5.5l-5 5a2 2 0 102.8 2.8l5-5a3.5 3.5 0 10-5-5l-5 5a1 1 0 001.4 1.4" />
            </svg>
          </button>
          <textarea
            ref="composerTextarea"
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
