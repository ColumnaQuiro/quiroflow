<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'

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
  channel: string
  lastMessage: Message | null
  unread: boolean
}
interface PatientOption {
  id: string
  first_name: string
  last_name: string | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()

const messages = ref<Message[]>([])
const patientNames = ref<Record<string, string>>({})
const patients = ref<PatientOption[]>([])
const loading = ref(true)
const search = ref('')
// conversation_key -> ISO timestamp of when staff last opened it. Loaded
// once and updated locally on open/delete rather than reloaded from the
// server each time -- this account's whole team shares one inbox, so a
// stale read state from someone else's concurrent session is a rare,
// low-stakes edge case, not worth a realtime subscription of its own.
const readTimestamps = ref<Record<string, string>>({})
async function loadReadTimestamps() {
  if (!store.accountId) return
  const { data } = await supabase.from('whatsapp_conversation_reads').select('conversation_key, last_read_at').eq('account_id', store.accountId)
  const next: Record<string, string> = {}
  for (const r of data ?? []) next[r.conversation_key] = r.last_read_at
  readTimestamps.value = next
}
onMounted(loadReadTimestamps)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, patient_id, phone_number, direction, status, body_preview, template_name, media_type, media_storage_path, media_mime_type, media_filename, channel, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  messages.value = data ?? []

  const patientIds = [...new Set(messages.value.map((m) => m.patient_id).filter((id): id is string => !!id))]
  if (patientIds.length > 0) {
    const { data: matchedPatients } = await supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
    const names: Record<string, string> = {}
    for (const p of matchedPatients ?? []) names[p.id] = `${p.first_name} ${p.last_name ?? ''}`.trim()
    patientNames.value = names
  }
  loading.value = false
}
onMounted(load)
// Bounded on purpose -- this only backs the "+ New" picker's empty-query
// browse list. It used to fetch every patient unbounded, which PostgREST
// silently caps well under most accounts' real patient counts, making
// patients past the cap unsearchable here (searchComposePatients below
// queries the DB directly instead, so it isn't affected).
onMounted(async () => {
  const { data } = await supabase.from('patients').select('id, first_name, last_name').order('first_name').limit(20)
  patients.value = data ?? []
})

const conversations = computed<Conversation[]>(() => {
  const byKey = new Map<string, Message[]>()
  for (const m of messages.value) {
    const key = m.patient_id ?? m.phone_number ?? 'unknown'
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(m)
  }
  const list: Conversation[] = []
  for (const [key, msgs] of byKey) {
    const last = msgs[0] // messages already ordered desc
    list.push({
      key,
      patientId: last.patient_id,
      phoneNumber: last.phone_number,
      name: (last.patient_id && patientNames.value[last.patient_id]) || last.phone_number || 'Unknown',
      channel: last.channel,
      lastMessage: last,
      unread: last.direction === 'inbound' && (!readTimestamps.value[key] || readTimestamps.value[key] < last.created_at),
    })
  }
  return list.sort((a, b) => b.lastMessage!.created_at.localeCompare(a.lastMessage!.created_at))
})

const filteredConversations = computed(() => {
  if (!search.value.trim()) return conversations.value
  const q = search.value.trim().toLowerCase()
  return conversations.value.filter((c) => c.name.toLowerCase().includes(q))
})

const selectedKey = ref<string | null>(null)
// A brand-new conversation started via "New message" has no rows in
// `whatsapp_messages` yet, so it can't come from the `conversations` list --
// it lives here until the first template send lands it in the real table.
const draftConversation = ref<Conversation | null>(null)
const selected = computed(
  () => conversations.value.find((c) => c.key === selectedKey.value) ?? (draftConversation.value?.key === selectedKey.value ? draftConversation.value : null),
)
const thread = computed(() =>
  selectedKey.value ? messages.value.filter((m) => (m.patient_id ?? m.phone_number ?? 'unknown') === selectedKey.value).slice().reverse() : [],
)

const composeOpen = ref(false)
const composeQuery = ref('')
const composeEl = ref<HTMLElement | null>(null)
const composeSearchResults = ref<PatientOption[]>([])
let composeSearchTimer: ReturnType<typeof setTimeout>
watch(composeQuery, (q) => {
  clearTimeout(composeSearchTimer)
  if (!q.trim()) {
    composeSearchResults.value = []
    return
  }
  composeSearchTimer = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .ilike('search_name', `%${normalizeSearchTerm(q.trim())}%`)
      .order('first_name')
      .limit(20)
    composeSearchResults.value = data ?? []
  }, 250)
})
const filteredComposePatients = computed(() => (composeQuery.value.trim() ? composeSearchResults.value : patients.value))
function onClickOutsideCompose(e: MouseEvent) {
  if (composeEl.value && !composeEl.value.contains(e.target as Node)) composeOpen.value = false
}
onMounted(() => document.addEventListener('click', onClickOutsideCompose))
onUnmounted(() => document.removeEventListener('click', onClickOutsideCompose))
function startConversationWith(p: PatientOption) {
  composeOpen.value = false
  composeQuery.value = ''
  const existing = conversations.value.find((c) => c.patientId === p.id)
  if (existing) {
    selectedKey.value = existing.key
    return
  }
  const name = `${p.first_name} ${p.last_name ?? ''}`.trim()
  draftConversation.value = { key: p.id, patientId: p.id, phoneNumber: null, name, channel: 'whatsapp', lastMessage: null, unread: false }
  selectedKey.value = p.id
}

async function markRead(key: string) {
  const now = new Date().toISOString()
  readTimestamps.value = { ...readTimestamps.value, [key]: now }
  if (!store.accountId) return
  await supabase.from('whatsapp_conversation_reads').upsert({ account_id: store.accountId, conversation_key: key, last_read_at: now } as never)
}

function selectConversation(c: Conversation) {
  draftConversation.value = null
  selectedKey.value = c.key
  if (c.unread) markRead(c.key)
}

const deletingConversation = ref(false)
async function deleteConversation() {
  if (!selected.value || !selectedKey.value) return
  if (!confirm(`Delete this whole conversation with ${selected.value.name}? This removes all messages and can't be undone.`)) return
  deletingConversation.value = true
  const key = selectedKey.value
  try {
    let query = supabase.from('whatsapp_messages').delete()
    query = selected.value.patientId ? query.eq('patient_id', selected.value.patientId) : query.eq('phone_number', selected.value.phoneNumber!)
    await query
    if (store.accountId) await supabase.from('whatsapp_conversation_reads').delete().eq('account_id', store.accountId).eq('conversation_key', key)
    messages.value = messages.value.filter((m) => (m.patient_id ?? m.phone_number ?? 'unknown') !== key)
    selectedKey.value = null
  } finally {
    deletingConversation.value = false
  }
}

// Signed URLs for media, resolved on demand and cached per storage path --
// the bucket is private, so every view needs its own short-lived URL.
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
const isNewConversation = computed(() => thread.value.length === 0)

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')
const fileInput = ref<HTMLInputElement>()
const composerTextarea = ref<HTMLTextAreaElement>()
const templateModalOpen = ref(false)

// Inserts at the cursor rather than replacing composerText outright, so
// picking a saved reply doesn't clobber anything the practitioner already
// typed.
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
    await useStaffFetch('/api/whatsapp/inbox-send', {
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
    await useStaffFetch('/api/whatsapp/inbox-send', {
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

function onTemplateSent() {
  templateModalOpen.value = false
  draftConversation.value = null
  load()
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function relativeDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diffDays = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
function previewText(m: Message) {
  if (m.media_type) return `📎 ${m.media_type}${m.body_preview ? ` — ${m.body_preview}` : ''}`
  if (m.template_name) return m.body_preview ?? `Template: ${m.template_name}`
  return m.body_preview ?? '—'
}

// Live updates: new inbound/outbound messages land without a manual refresh.
let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, () => load())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, () => load())
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Inbox" />
    <div class="flex flex-1 overflow-hidden">
      <!-- Conversation list -->
      <div class="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div class="flex items-center gap-2 border-b border-line-divider p-3">
          <input
            v-model="search"
            type="search"
            placeholder="Search conversations…"
            class="h-8 w-full flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
          <div ref="composeEl" class="relative shrink-0">
            <UiBtn variant="primary" size="sm" @click="composeOpen = !composeOpen">+ New</UiBtn>
            <div v-if="composeOpen" class="absolute right-0 top-[calc(100%+4px)] z-20 w-64 rounded-card border border-line bg-surface p-2 shadow-popover">
              <input
                v-model="composeQuery"
                type="text"
                autofocus
                placeholder="Search patients…"
                class="h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
              />
              <ul class="mt-1.5 max-h-56 overflow-y-auto">
                <li
                  v-for="p in filteredComposePatients"
                  :key="p.id"
                  class="cursor-pointer rounded-ctlSm px-2 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle"
                  @click="startConversationWith(p)"
                >
                  {{ p.first_name }} {{ p.last_name }}
                </li>
                <li v-if="filteredComposePatients.length === 0" class="px-2 py-1.5 text-[13px] text-ink-faint">No matches</li>
              </ul>
            </div>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
          <p v-else-if="filteredConversations.length === 0" class="p-6 text-center text-[13px] text-ink-faint">No conversations yet.</p>
          <button
            v-for="c in filteredConversations"
            :key="c.key"
            type="button"
            class="flex w-full items-start gap-2.5 border-b border-line-row px-3 py-2.5 text-left hover:bg-surface-subtle"
            :class="selectedKey === c.key ? 'bg-brand-tint' : ''"
            @click="selectConversation(c)"
          >
            <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
              {{ c.name.slice(0, 2).toUpperCase() }}
              <span class="absolute -bottom-0.5 -right-0.5 flex h-[13px] w-[13px] items-center justify-center rounded-full border border-surface bg-[#25D366]" title="WhatsApp">
                <svg viewBox="0 0 24 24" class="h-[8px] w-[8px] fill-white"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.4-.1.2-.3.4-.4.5-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.5 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z" /></svg>
              </span>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-[13px] font-[560]" :class="c.unread ? 'text-ink-900' : 'text-ink-700'">{{ c.name }}</p>
                <span class="shrink-0 text-[11px] text-ink-faint">{{ shortTime(c.lastMessage!.created_at) }}</span>
              </div>
              <p class="truncate text-[12px]" :class="c.unread ? 'font-medium text-ink-800' : 'text-ink-muted2'">
                {{ c.lastMessage!.direction === 'outbound' ? 'You: ' : '' }}{{ previewText(c.lastMessage!) }}
              </p>
            </div>
            <span v-if="c.unread" class="mt-1 h-[8px] w-[8px] shrink-0 rounded-full bg-brand" />
          </button>
        </div>
      </div>

      <!-- Thread -->
      <div v-if="!selected" class="flex flex-1 items-center justify-center text-[13px] text-ink-faint">
        Select a conversation to view messages.
      </div>
      <div v-else class="flex min-w-0 flex-1 flex-col bg-surface-page">
        <div class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
            {{ selected.name.slice(0, 2).toUpperCase() }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] font-[600] text-ink-900">{{ selected.name }}</p>
            <p class="truncate text-[11.5px] text-ink-muted2">
              <span class="rounded-pill bg-[#25D366]/10 px-1.5 py-px font-medium text-[#128C4B]">WhatsApp</span>
              <span v-if="selected.phoneNumber" class="ml-1.5">{{ selected.phoneNumber }}</span>
            </p>
          </div>
          <NuxtLink v-if="selected.patientId" :to="`/patients/${selected.patientId}`" class="shrink-0 text-[12.5px] text-brand-text hover:text-brand-hover">
            View patient →
          </NuxtLink>
          <button
            v-if="!isNewConversation"
            type="button"
            class="shrink-0 text-[12.5px] text-danger-text hover:underline disabled:opacity-50"
            :disabled="deletingConversation"
            @click="deleteConversation"
          >
            Delete conversation
          </button>
        </div>

        <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <template v-for="(m, i) in thread" :key="m.id">
            <div v-if="i === 0 || relativeDay(m.created_at) !== relativeDay(thread[i - 1].created_at)" class="flex justify-center">
              <span class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-text">{{ relativeDay(m.created_at) }}</span>
            </div>
            <div class="flex" :class="m.direction === 'outbound' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[70%] rounded-card px-3 py-2 shadow-card"
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

                <p v-if="m.body_preview && m.media_type" class="mt-1 whitespace-pre-wrap text-[13px]">{{ m.body_preview }}</p>
                <p v-else-if="m.template_name" class="whitespace-pre-wrap text-[13px]">{{ m.body_preview ?? `Template: ${m.template_name}` }}</p>
                <p v-else class="whitespace-pre-wrap text-[13px]">{{ m.body_preview }}</p>

                <p class="mt-1 flex items-center justify-end gap-1 text-right text-[10.5px]" :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'">
                  <span>{{ shortTime(m.created_at) }}</span>
                  <span v-if="m.direction === 'outbound' && m.status === 'failed'" class="text-danger-text" title="Failed to send">⚠</span>
                  <span v-else-if="m.direction === 'outbound' && m.status === 'read'" class="text-[13px] leading-none text-[#34B7F1]" title="Read">✓✓</span>
                  <span v-else-if="m.direction === 'outbound' && m.status === 'delivered'" class="text-[13px] leading-none" title="Delivered">✓✓</span>
                  <span v-else-if="m.direction === 'outbound'" class="text-[13px] leading-none" title="Sent">✓</span>
                </p>
              </div>
            </div>
          </template>
        </div>

        <div class="shrink-0 border-t border-line bg-surface p-3">
          <p v-if="sendError" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
          <div v-if="!within24h" class="flex items-center justify-between gap-3 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2">
            <p class="text-[12.5px] text-warning-text">
              <template v-if="isNewConversation">{{ selected.name }} hasn't messaged you before — start with an approved template.</template>
              <template v-else>More than 24h since {{ selected.name }} last messaged — free-form replies are blocked by WhatsApp. Send a template instead.</template>
            </p>
            <UiBtn v-if="selected.patientId" variant="primary" size="sm" @click="templateModalOpen = true">Send template</UiBtn>
          </div>
          <div v-else class="flex items-end gap-2">
            <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle" :disabled="sending" @click="fileInput?.click()">
              📎
            </button>
            <input ref="fileInput" type="file" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" @change="onFileChosen" />
            <SavedRepliesPicker @insert="insertReply" />
            <textarea
              ref="composerTextarea"
              v-model="composerText"
              rows="1"
              placeholder="Type a message…"
              class="max-h-24 min-h-9 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none"
              @keydown.enter.exact.prevent="sendText"
            />
            <UiBtn variant="primary" :disabled="sending || !composerText.trim()" @click="sendText">{{ sending ? '…' : 'Send' }}</UiBtn>
          </div>
        </div>
      </div>
    </div>

    <SendWhatsAppModal
      v-if="templateModalOpen && selected?.patientId"
      :patient-id="selected.patientId"
      :patient-first-name="selected.name.split(' ')[0]"
      @close="templateModalOpen = false"
      @sent="onTemplateSent"
    />
  </div>
</template>
