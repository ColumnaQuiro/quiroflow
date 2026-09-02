<script setup lang="ts">
const props = defineProps<{ accountId: string; teamMemberId: string }>()

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
  pending?: boolean
}
interface Conversation {
  key: string
  patientId: string | null
  phoneNumber: string | null
  name: string
  channel: string
  lastMessage: Message
  unread: boolean
}

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { keyboardHeight } = useKeyboardInset()
const messagesEl = ref<HTMLElement>()
function scrollThreadToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}
watch(keyboardHeight, (h) => {
  if (h > 0) scrollThreadToBottom()
})

// Edge-swipe from the thread back to the conversation list, like the
// native iOS back gesture -- there's no real navigation stack here for iOS
// to hook its own gesture into, so this reimplements the recognizable part
// of it by hand, including live tracking (see useSwipeBack). Watches
// selected rather than attaching once on mount: threadEl only exists in the
// DOM while a conversation is open or the close animation is still
// settling, so the ref is null between opens and needs reattaching each time.
const threadEl = ref<HTMLElement>()
const swipeBack = useSwipeBack(() => {
  selectedKey.value = null
})
watch(threadEl, (el, prevEl) => {
  if (prevEl) swipeBack.detach(prevEl)
  if (el) swipeBack.attach(el)
})

// Messages this device has sent but the server hasn't confirmed into the
// real table yet -- rendered inline with a clock icon so the composer
// clears and the message appears immediately (WhatsApp-style) instead of
// waiting on the round trip. load() naturally supersedes one once the real
// row shows up in `messages`; on failure it's kept and flipped to a failed
// status instead of vanishing.
const pendingMessages = ref<Message[]>([])

const messages = ref<Message[]>([])
const patientNames = ref<Record<string, string>>({})
const loading = ref(true)
const readTimestamps = ref<Record<string, string>>({})
async function loadReadTimestamps() {
  const { data } = await supabase.from('whatsapp_conversation_reads').select('conversation_key, last_read_at').eq('account_id', props.accountId)
  const next: Record<string, string> = {}
  for (const r of data ?? []) next[r.conversation_key] = r.last_read_at
  readTimestamps.value = next
}
onMounted(loadReadTimestamps)

interface LabelDef { id: string; name: string; color: string }
const archivedKeys = ref<Set<string>>(new Set())
const myLabelsByKey = ref<Record<string, string[]>>({})
const labels = ref<LabelDef[]>([])
async function loadArchivesAndLabels() {
  const [{ data: archives }, { data: assigns }, { data: labelRows }] = await Promise.all([
    supabase.from('whatsapp_conversation_archives').select('conversation_key').eq('team_member_id', props.teamMemberId),
    supabase.from('whatsapp_conversation_labels').select('conversation_key, label_id').eq('team_member_id', props.teamMemberId),
    supabase.from('whatsapp_labels').select('id, name, color').order('name'),
  ])
  archivedKeys.value = new Set((archives ?? []).map((a) => a.conversation_key))
  const byKey: Record<string, string[]> = {}
  for (const a of assigns ?? []) (byKey[a.conversation_key] ??= []).push(a.label_id)
  myLabelsByKey.value = byKey
  labels.value = labelRows ?? []
}
onMounted(loadArchivesAndLabels)

async function load() {
  loading.value = true
  const [{ data: waData }, { data: appData }] = await Promise.all([
    supabase
      .from('whatsapp_messages')
      .select('id, patient_id, phone_number, direction, status, body_preview, template_name, media_type, media_storage_path, media_mime_type, media_filename, channel, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('patient_app_messages').select('id, patient_id, direction, body, created_at').order('created_at', { ascending: false }).limit(500),
  ])
  const appMessages: Message[] = (appData ?? []).map((m) => ({
    id: m.id,
    patient_id: m.patient_id,
    phone_number: null,
    direction: m.direction,
    status: 'sent',
    body_preview: m.body,
    template_name: null,
    media_type: null,
    media_storage_path: null,
    media_mime_type: null,
    media_filename: null,
    channel: 'in_app',
    created_at: m.created_at,
  }))
  messages.value = [...(waData ?? []), ...appMessages].sort((a, b) => b.created_at.localeCompare(a.created_at))

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

const allMessages = computed<Message[]>(() =>
  [...messages.value, ...pendingMessages.value].sort((a, b) => b.created_at.localeCompare(a.created_at)),
)

const conversations = computed<Conversation[]>(() => {
  const byKey = new Map<string, Message[]>()
  for (const m of allMessages.value) {
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
      channel: last.channel,
      lastMessage: last,
      unread: last.direction === 'inbound' && (!readTimestamps.value[key] || readTimestamps.value[key] < last.created_at),
    })
  }
  return list.sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at))
})

// Search matches name, phone number, and anything said in the conversation
// -- not just the last message -- so finding "that time they mentioned X"
// works the same as finding a patient by name or number.
const search = ref('')
const conversationSearchText = computed(() => {
  const map: Record<string, string> = {}
  for (const m of allMessages.value) {
    const key = m.patient_id ?? m.phone_number ?? 'unknown'
    map[key] = `${map[key] ?? ''} ${m.body_preview ?? ''}`
  }
  return map
})
const view = ref<'active' | 'archived'>('active')
const unreadOnly = ref(false)
const replyFilter = ref<'all' | 'awaiting_us' | 'awaiting_patient'>('all')
const labelFilter = ref<string | null>(null)
const filterSheetOpen = ref(false)

const filteredConversations = computed(() => {
  let list = conversations.value.filter((c) => archivedKeys.value.has(c.key) === (view.value === 'archived'))
  if (search.value.trim()) {
    const q = normalizeSearchTerm(search.value.trim())
    list = list.filter((c) => normalizeSearchTerm(`${c.name} ${c.phoneNumber ?? ''} ${conversationSearchText.value[c.key] ?? ''}`).includes(q))
  }
  if (unreadOnly.value) list = list.filter((c) => c.unread)
  if (replyFilter.value === 'awaiting_us') list = list.filter((c) => c.lastMessage.direction === 'inbound')
  else if (replyFilter.value === 'awaiting_patient') list = list.filter((c) => c.lastMessage.direction === 'outbound')
  if (labelFilter.value) list = list.filter((c) => myLabelsByKey.value[c.key]?.includes(labelFilter.value!))
  return list
})

// Bulk select: tap "Select" to enter the mode, tap rows to check them, then
// mark them all unread or delete them together instead of one swipe at a
// time.
const selectionMode = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
function toggleSelectKey(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}
function exitSelectionMode() {
  selectionMode.value = false
  selectedKeys.value = new Set()
}

const selectedKey = ref<string | null>(null)
const selected = computed(() => conversations.value.find((c) => c.key === selectedKey.value) ?? null)
const thread = computed(() =>
  selectedKey.value ? allMessages.value.filter((m) => (m.patient_id ?? m.phone_number ?? 'unknown') === selectedKey.value).slice().reverse() : [],
)
// Follows the bottom of the thread automatically -- a reply the practitioner
// just sent, or a message that just arrived, used to sit hidden behind the
// composer bar until they scrolled by hand.
watch(thread, () => scrollThreadToBottom())
watch(selectedKey, (key) => {
  if (key) scrollThreadToBottom()
})

async function markRead(key: string) {
  const now = new Date().toISOString()
  readTimestamps.value = { ...readTimestamps.value, [key]: now }
  await supabase.from('whatsapp_conversation_reads').upsert({ account_id: props.accountId, conversation_key: key, last_read_at: now } as never)
}
function openConversation(c: Conversation) {
  selectedKey.value = c.key
  if (c.unread) markRead(c.key)
}

const deletingConversation = ref(false)
async function deleteKeys(keys: string[]) {
  deletingConversation.value = true
  try {
    for (const key of keys) {
      const c = conversations.value.find((conv) => conv.key === key)
      if (!c) continue
      let query = supabase.from('whatsapp_messages').delete()
      query = c.patientId ? query.eq('patient_id', c.patientId) : query.eq('phone_number', c.phoneNumber!)
      await query
      if (c.patientId) await supabase.from('patient_app_messages').delete().eq('patient_id', c.patientId)
      await supabase.from('whatsapp_conversation_reads').delete().eq('account_id', props.accountId).eq('conversation_key', key)
      await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', props.teamMemberId).eq('conversation_key', key)
      await supabase.from('whatsapp_conversation_labels').delete().eq('team_member_id', props.teamMemberId).eq('conversation_key', key)
    }
    messages.value = messages.value.filter((m) => !keys.includes(m.patient_id ?? m.phone_number ?? 'unknown'))
    pendingMessages.value = pendingMessages.value.filter((m) => !keys.includes(m.patient_id ?? m.phone_number ?? 'unknown'))
    if (selectedKey.value && keys.includes(selectedKey.value)) selectedKey.value = null
  } finally {
    deletingConversation.value = false
  }
}
async function deleteConversationByKey(c: Conversation) {
  if (!confirm(`Delete this whole conversation with ${c.name}? This removes all messages and can't be undone.`)) return
  await deleteKeys([c.key])
}
async function deleteConversation() {
  if (!selected.value) return
  await deleteConversationByKey(selected.value)
}
function deleteFromList(c: Conversation) {
  swipedKey.value = null
  deleteConversationByKey(c)
}
async function bulkDeleteSelected() {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  if (!confirm(`Delete ${keys.length} conversation${keys.length > 1 ? 's' : ''}? This removes all their messages and can't be undone.`)) return
  await deleteKeys(keys)
  exitSelectionMode()
}
async function bulkMarkUnreadSelected() {
  const past = new Date(0).toISOString()
  for (const key of selectedKeys.value) {
    readTimestamps.value = { ...readTimestamps.value, [key]: past }
    await supabase.from('whatsapp_conversation_reads').upsert({ account_id: props.accountId, conversation_key: key, last_read_at: past } as never)
  }
  exitSelectionMode()
}

async function bulkArchiveSelected(archive: boolean) {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  if (archive) {
    const next = new Set(archivedKeys.value)
    for (const k of keys) next.add(k)
    archivedKeys.value = next
    await supabase.from('whatsapp_conversation_archives').upsert(keys.map((k) => ({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: k })) as never)
  } else {
    const next = new Set(archivedKeys.value)
    for (const k of keys) next.delete(k)
    archivedKeys.value = next
    await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', props.teamMemberId).in('conversation_key', keys)
  }
  exitSelectionMode()
}

// Single-conversation archive toggle, used from the row swipe action.
async function toggleArchive(c: Conversation) {
  swipedKey.value = null
  const isArchived = archivedKeys.value.has(c.key)
  const next = new Set(archivedKeys.value)
  if (isArchived) next.delete(c.key)
  else next.add(c.key)
  archivedKeys.value = next
  if (isArchived) {
    await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', props.teamMemberId).eq('conversation_key', c.key)
  } else {
    await supabase.from('whatsapp_conversation_archives').upsert({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: c.key } as never)
  }
}

// Mixed-selection rule matches the checkbox convention used elsewhere: if
// every key already has the label, remove it from all; otherwise add it to
// whichever are missing it, rather than clearing first.
async function toggleLabelForKeys(labelId: string, keys: string[]) {
  if (keys.length === 0) return
  const allApplied = keys.every((k) => myLabelsByKey.value[k]?.includes(labelId))
  const nextByKey = { ...myLabelsByKey.value }
  if (allApplied) {
    for (const k of keys) nextByKey[k] = (nextByKey[k] ?? []).filter((id) => id !== labelId)
    myLabelsByKey.value = nextByKey
    await supabase.from('whatsapp_conversation_labels').delete().eq('team_member_id', props.teamMemberId).eq('label_id', labelId).in('conversation_key', keys)
  } else {
    const toAdd = keys.filter((k) => !myLabelsByKey.value[k]?.includes(labelId))
    for (const k of toAdd) nextByKey[k] = [...(nextByKey[k] ?? []), labelId]
    myLabelsByKey.value = nextByKey
    await supabase.from('whatsapp_conversation_labels').upsert(toAdd.map((k) => ({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: k, label_id: labelId })) as never)
  }
}

async function createLabel(name: string, color: string, applyToKeys: string[]) {
  const { data } = await supabase.from('whatsapp_labels').insert({ account_id: props.accountId, name, color, created_by: props.teamMemberId }).select('id, name, color').single()
  if (!data) return
  labels.value = [...labels.value, data].sort((a, b) => a.name.localeCompare(b.name))
  if (applyToKeys.length > 0) await toggleLabelForKeys(data.id, applyToKeys)
}

// Marking unread is the mirror of markRead: back-date the read timestamp
// instead of clearing it, since a conversation with no read record at all
// is already "unread" by definition (see the `unread` computed above) --
// backdating just re-triggers that same rule on demand.
async function toggleUnread(c: Conversation) {
  swipedKey.value = null
  if (c.unread) {
    await markRead(c.key)
    return
  }
  const past = new Date(0).toISOString()
  readTimestamps.value = { ...readTimestamps.value, [c.key]: past }
  await supabase.from('whatsapp_conversation_reads').upsert({ account_id: props.accountId, conversation_key: c.key, last_read_at: past } as never)
}

// Swipe-to-reveal on each conversation row, live-following the finger like
// the native iOS gesture rather than only snapping at the end -- dragX
// tracks the actual touch position during the gesture (with resistance past
// either end, since there's nothing further to reveal beyond the buttons or
// left of closed), and only touchend decides open/closed, by final distance
// OR flick velocity so a fast short swipe commits the same as a slow long
// one. justSwiped exists because a touchend that opens/closes the row is
// immediately followed by a synthesized click on the same element; without
// it, that click's own handler (see the template) would see swipedKey
// already set and instantly close what touchend just opened.
const ROW_ACTIONS_WIDTH = 228 // Unread + Archive + Delete, 76px each
const swipedKey = ref<string | null>(null)
const draggingKey = ref<string | null>(null)
const rowDragX = ref(0)
let rowTouchStartX = 0
let rowTouchStartY = 0
let rowSwiping = false
let justSwiped = false
let rowSamples: { x: number; t: number }[] = []
function rowBaseOffset(key: string) {
  return swipedKey.value === key ? -ROW_ACTIONS_WIDTH : 0
}
function onRowTouchStart(e: TouchEvent, c: Conversation) {
  if (selectionMode.value) return
  rowTouchStartX = e.touches[0]?.clientX ?? 0
  rowTouchStartY = e.touches[0]?.clientY ?? 0
  rowSwiping = false
  draggingKey.value = c.key
  rowDragX.value = rowBaseOffset(c.key)
  rowSamples = [{ x: rowTouchStartX, t: performance.now() }]
}
function onRowTouchMove(e: TouchEvent, c: Conversation) {
  if (selectionMode.value) return
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - rowTouchStartX
  const dy = Math.abs(t.clientY - rowTouchStartY)
  if (!rowSwiping) {
    if (dy > 20 && dy > Math.abs(dx)) {
      draggingKey.value = null
      return
    }
    if (Math.abs(dx) > 10) {
      rowSwiping = true
      draggingKey.value = c.key
    }
  }
  if (!rowSwiping) return
  let next = rowBaseOffset(c.key) + dx
  if (next > 0) next *= 0.3
  else if (next < -ROW_ACTIONS_WIDTH) next = -ROW_ACTIONS_WIDTH + (next + ROW_ACTIONS_WIDTH) * 0.3
  rowDragX.value = next
  rowSamples.push({ x: t.clientX, t: performance.now() })
  if (rowSamples.length > 6) rowSamples.shift()
}
function onRowTouchEnd(e: TouchEvent, c: Conversation) {
  if (selectionMode.value || !rowSwiping) {
    draggingKey.value = null
    return
  }
  justSwiped = true
  const first = rowSamples[0]
  const last = rowSamples[rowSamples.length - 1]
  const dt = Math.max(1, last.t - first.t)
  const velocity = (last.x - first.x) / dt // px/ms, negative = moving left (opening)
  let willOpen: boolean
  if (velocity < -0.5) willOpen = true
  else if (velocity > 0.5) willOpen = false
  else willOpen = rowDragX.value < -ROW_ACTIONS_WIDTH / 2
  swipedKey.value = willOpen ? c.key : null
  draggingKey.value = null
}
function onRowClick(c: Conversation) {
  if (selectionMode.value) {
    toggleSelectKey(c.key)
    return
  }
  if (justSwiped) {
    justSwiped = false
    return
  }
  if (swipedKey.value) {
    swipedKey.value = null
    return
  }
  openConversation(c)
}

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

const replyChannel = computed(() => (thread.value.length === 0 ? 'whatsapp' : thread.value[thread.value.length - 1].channel))
const within24h = computed(() => {
  if (replyChannel.value === 'in_app') return true
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound' && m.channel === 'whatsapp').at(-1)
  if (!lastInbound) return false
  return Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 60 * 60 * 1000
})

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')
const composerTextarea = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const cameraInput = ref<HTMLInputElement>()

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

// What it takes to redo a send: kept per pending/failed message id so a
// failed bubble can be retried in place (same id, same position in the
// thread) rather than the user having to retype or reattach anything.
// Cleared once a send actually succeeds.
type RetryPayload =
  | { kind: 'text'; text: string; channel: string }
  | { kind: 'media'; mediaBase64: string; mediaMimeType: string; mediaFilename: string; mediaKind: 'image' | 'video' | 'audio' | 'document' }
const retryPayloads = ref<Record<string, RetryPayload>>({})

async function performTextSend(tempId: string, text: string, channel: string, target: Conversation) {
  sending.value = true
  try {
    if (channel === 'in_app') {
      if (!target.patientId) throw new Error('In-app messages require a linked patient')
      await authedFetch('/api/patient-messages/send', { method: 'POST', body: { patientId: target.patientId, text } })
    } else {
      await authedFetch('/api/whatsapp/inbox-send', {
        method: 'POST',
        body: {
          patientId: target.patientId ?? undefined,
          phoneNumber: target.patientId ? undefined : target.phoneNumber,
          text,
        },
      })
    }
    // Flip the pending bubble to "sent" in place, same array entry and same
    // v-for key, before the reconcile below -- Vue can patch the icon alone
    // with no layout shift. Swapping straight to the real server row here
    // instead would change the element's key mid-transition (tempId -> real
    // id), forcing a full remount at the exact moment the icon changes,
    // which is what read as a visible "jump" on the sent tick appearing.
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
    await load()
    pendingMessages.value = pendingMessages.value.filter((m) => m.id !== tempId)
    delete retryPayloads.value[tempId]
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? 'Failed to send'
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, pending: false, status: 'failed' } : m))
  } finally {
    sending.value = false
  }
}

async function sendText() {
  if (!composerText.value.trim() || !selected.value) return
  sendError.value = ''
  const text = composerText.value.trim()
  const channel = replyChannel.value
  const target = selected.value
  composerText.value = ''

  const tempId = `pending-${Date.now()}`
  retryPayloads.value[tempId] = { kind: 'text', text, channel }
  pendingMessages.value = [
    ...pendingMessages.value,
    {
      id: tempId,
      patient_id: target.patientId,
      phone_number: target.phoneNumber,
      direction: 'outbound',
      status: 'pending',
      body_preview: text,
      template_name: null,
      media_type: null,
      media_storage_path: null,
      media_mime_type: null,
      media_filename: null,
      channel,
      created_at: new Date().toISOString(),
      pending: true,
    },
  ]
  await performTextSend(tempId, text, channel, target)
}

const MAX_MEDIA_BYTES = 16 * 1024 * 1024
function mediaKindForFile(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}
async function performMediaSend(
  tempId: string,
  mediaBase64: string,
  mediaMimeType: string,
  mediaFilename: string,
  mediaKind: 'image' | 'video' | 'audio' | 'document',
  target: Conversation,
) {
  sending.value = true
  try {
    await authedFetch('/api/whatsapp/inbox-send', {
      method: 'POST',
      body: {
        patientId: target.patientId ?? undefined,
        phoneNumber: target.patientId ? undefined : target.phoneNumber,
        mediaBase64,
        mediaMimeType,
        mediaFilename,
        mediaKind,
      },
    })
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
    await load()
    pendingMessages.value = pendingMessages.value.filter((m) => m.id !== tempId)
    delete retryPayloads.value[tempId]
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? 'Failed to send'
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, pending: false, status: 'failed' } : m))
  } finally {
    sending.value = false
  }
}

async function sendMedia(mediaBase64: string, mediaMimeType: string, mediaFilename: string, mediaKind: 'image' | 'video' | 'audio' | 'document') {
  if (!selected.value) return
  sendError.value = ''
  const target = selected.value
  const tempId = `pending-${Date.now()}`
  retryPayloads.value[tempId] = { kind: 'media', mediaBase64, mediaMimeType, mediaFilename, mediaKind }
  pendingMessages.value = [
    ...pendingMessages.value,
    {
      id: tempId,
      patient_id: target.patientId,
      phone_number: target.phoneNumber,
      direction: 'outbound',
      status: 'pending',
      body_preview: null,
      template_name: null,
      media_type: mediaKind,
      media_storage_path: null,
      media_mime_type: mediaMimeType,
      media_filename: mediaFilename,
      channel: replyChannel.value,
      created_at: new Date().toISOString(),
      pending: true,
    },
  ]
  await performMediaSend(tempId, mediaBase64, mediaMimeType, mediaFilename, mediaKind, target)
}

// Tapping a failed bubble (text or media) retries with the exact same
// payload, in place -- same id, same spot in the thread, just flips back
// to the pending clock icon while it's in flight.
async function retryMessage(m: Message) {
  const payload = retryPayloads.value[m.id]
  if (!payload || !selected.value) return
  sendError.value = ''
  pendingMessages.value = pendingMessages.value.map((p) => (p.id === m.id ? { ...p, pending: true, status: 'pending' } : p))
  if (payload.kind === 'text') {
    await performTextSend(m.id, payload.text, payload.channel, selected.value)
  } else {
    await performMediaSend(m.id, payload.mediaBase64, payload.mediaMimeType, payload.mediaFilename, payload.mediaKind, selected.value)
  }
}

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !selected.value) {
    input.value = ''
    return
  }
  if (file.size > MAX_MEDIA_BYTES) {
    sendError.value = 'File is too large (max 16 MB).'
    input.value = ''
    return
  }
  const kind = mediaKindForFile(file)
  if (kind === 'image') {
    try {
      const { blob, mimeType } = await normalizeImageForWhatsApp(file)
      const base64 = await blobToBase64(blob)
      await sendMedia(base64, mimeType, file.name.replace(/\.\w+$/, '.jpg'), 'image')
    } catch (err: any) {
      sendError.value = err?.message ?? 'Could not process this image.'
    }
  } else {
    const base64 = await blobToBase64(file)
    await sendMedia(base64, file.type, file.name, kind)
  }
  input.value = ''
}

const { recording: audioRecording, seconds: audioSeconds, start: startAudioRecording, stop: stopAudioRecording, cancel: cancelAudioRecording } =
  useAudioRecorder()

async function toggleAudioRecording() {
  if (audioRecording.value) {
    const result = await stopAudioRecording()
    if (!result) return
    const filename = `voice-note.${extensionForAudioMimeType(result.mimeType)}`
    const base64 = await blobToBase64(result.blob)
    await sendMedia(base64, result.mimeType, filename, 'audio')
  } else {
    try {
      await startAudioRecording()
    } catch {
      sendError.value = 'Could not access the microphone -- check permissions.'
    }
  }
}
function recordingLabel(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Fullscreen viewer for tapping any image in the thread (mine or theirs) --
// mediaUrls' signed URL already works as a direct download link.
const lightboxUrl = ref<string | null>(null)

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
// The conversation list's timestamp, WhatsApp-style: a bare hour today loses
// meaning for anything older, so it steps down in precision the further back
// it goes -- hour today, "Yesterday", the weekday name within the last week,
// then a full date beyond that.
function listTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return shortTime(iso)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
function previewText(m: Message) {
  if (m.media_type) return `📎 ${m.media_type}${m.body_preview ? ` — ${m.body_preview}` : ''}`
  if (m.template_name) return m.body_preview ?? `Template: ${m.template_name}`
  return m.body_preview ?? '—'
}
// What actually renders as the bubble's text, distinct from previewText
// (used only for the conversation-list row) -- empty for media with no
// caption, since there's nothing to attach the inline time+status to.
function bubbleText(m: Message): string {
  if (m.media_type) return m.body_preview ?? ''
  if (m.template_name) return m.body_preview ?? `Template: ${m.template_name}`
  return m.body_preview ?? ''
}

let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('mobile-inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, () => load())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, () => load())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `account_id=eq.${props.accountId}` }, () => load())
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})

let orgChannel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  orgChannel = supabase
    .channel('mobile-inbox-labels-archives')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_labels', filter: `account_id=eq.${props.accountId}` }, () => loadArchivesAndLabels())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversation_labels', filter: `account_id=eq.${props.accountId}` }, () => loadArchivesAndLabels())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversation_archives', filter: `account_id=eq.${props.accountId}` }, () => loadArchivesAndLabels())
    .subscribe()
})
onUnmounted(() => {
  if (orgChannel) supabase.removeChannel(orgChannel)
})

// Belt-and-suspenders alongside the realtime subscription above -- a
// websocket that silently drops (backgrounded app, network blip) leaves the
// thread stuck until something else forces a reload, which reads as "I have
// to leave and come back to see a new message." A cheap periodic refetch
// bounds how stale the inbox can get even if realtime isn't delivering.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(load, 15000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <!-- Conversation list: always mounted underneath the thread overlay -->
    <div class="absolute inset-0 flex min-h-0 flex-col bg-surface">
      <div v-if="!selectionMode" class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search name, number, messages…"
          class="h-9 flex-1 rounded-ctl border border-line-control bg-surface-subtle px-3 text-[14px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border"
          :class="view === 'archived' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted'"
          :title="view === 'archived' ? 'Show active conversations' : 'Show archived conversations'"
          @click="view = view === 'archived' ? 'active' : 'archived'"
        >
          <svg viewBox="0 0 16 16" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3.5h12v2.5H2z" />
            <path d="M2.8 6v6.5a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V6" />
            <path d="M6.5 8.5h3" />
          </svg>
        </button>
        <button
          type="button"
          class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border"
          :class="unreadOnly || replyFilter !== 'all' || labelFilter ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted'"
          title="Filter"
          @click="filterSheetOpen = true"
        >
          <svg viewBox="0 0 16 16" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4h12M4.5 8h7M7 12h2" />
          </svg>
        </button>
        <button type="button" class="shrink-0 px-1 text-[13px] font-medium text-brand-text" @click="selectionMode = true">Select</button>
      </div>
      <div v-else class="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
        <button type="button" class="shrink-0 px-1 text-[13px] text-ink-muted2" @click="exitSelectionMode">Cancel</button>
        <p class="truncate text-[13px] text-ink-700">{{ selectedKeys.size }} selected</p>
        <div class="flex shrink-0 items-center gap-3">
          <InboxLabelPicker
            :labels="labels"
            :applied-ids="[]"
            @toggle-label="(id: string) => toggleLabelForKeys(id, [...selectedKeys])"
            @create-label="(name: string, color: string) => createLabel(name, color, [...selectedKeys])"
          />
          <button
            type="button"
            class="text-[13px] font-medium text-brand-text disabled:opacity-40"
            :disabled="selectedKeys.size === 0"
            @click="bulkArchiveSelected(view !== 'archived')"
          >
            {{ view === 'archived' ? 'Unarchive' : 'Archive' }}
          </button>
          <button type="button" class="text-[13px] font-medium text-brand-text disabled:opacity-40" :disabled="selectedKeys.size === 0" @click="bulkMarkUnreadSelected">Unread</button>
          <button type="button" class="text-[13px] font-medium text-danger-text disabled:opacity-40" :disabled="selectedKeys.size === 0" @click="bulkDeleteSelected">Delete</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
        <p v-else-if="filteredConversations.length === 0" class="p-6 text-center text-[13px] text-ink-faint">
          {{ view === 'archived' ? 'No archived conversations.' : 'No conversations yet.' }}
        </p>
        <div v-for="c in filteredConversations" :key="c.key" class="relative overflow-hidden border-b border-line-row">
          <div class="absolute inset-y-0 right-0 flex">
            <button type="button" class="flex w-[76px] items-center justify-center bg-brand text-[12px] font-medium text-white" @click="toggleUnread(c)">
              {{ c.unread ? 'Read' : 'Unread' }}
            </button>
            <button type="button" class="flex w-[76px] items-center justify-center bg-ink-muted text-[12px] font-medium text-white" @click="toggleArchive(c)">
              {{ archivedKeys.has(c.key) ? 'Unarchive' : 'Archive' }}
            </button>
            <button type="button" class="flex w-[76px] items-center justify-center bg-danger-text text-[12px] font-medium text-white" @click="deleteFromList(c)">
              Delete
            </button>
          </div>
          <button
            type="button"
            class="flex w-full items-start gap-3 bg-surface px-4 py-3 text-left active:bg-surface-subtle"
            :style="{
              transform: `translateX(${draggingKey === c.key ? rowDragX : swipedKey === c.key ? -ROW_ACTIONS_WIDTH : 0}px)`,
              transition: draggingKey === c.key ? 'none' : 'transform 200ms ease-out',
            }"
            @touchstart="onRowTouchStart($event, c)"
            @touchmove="onRowTouchMove($event, c)"
            @touchend="onRowTouchEnd($event, c)"
            @click="onRowClick(c)"
          >
          <span
            v-if="selectionMode"
            class="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
            :class="selectedKeys.has(c.key) ? 'border-brand bg-brand' : 'border-line-control bg-surface'"
          >
            <svg v-if="selectedKeys.has(c.key)" viewBox="0 0 16 16" class="h-3 w-3 text-white" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8l3.5 3.5L13 5" />
            </svg>
          </span>
          <span class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand-text">
            {{ c.name.slice(0, 2).toUpperCase() }}
            <span v-if="c.channel === 'whatsapp'" class="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-surface bg-[#25D366]" title="WhatsApp">
              <svg viewBox="0 0 24 24" class="h-[9px] w-[9px] fill-white"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.4-.1.2-.3.4-.4.5-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.5 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z" /></svg>
            </span>
            <span v-else class="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-surface bg-brand" title="In-app message">
              <svg viewBox="0 0 24 24" class="h-[9px] w-[9px] fill-white"><path d="M4 4h16v12H7l-3 3z" /></svg>
            </span>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-[14px] font-[560]" :class="c.unread ? 'text-ink-900' : 'text-ink-700'">
                {{ c.name }}
                <span v-if="c.phoneNumber && c.patientId" class="font-normal text-ink-faint">{{ c.phoneNumber }}</span>
              </p>
              <span class="shrink-0 text-[12px] text-ink-faint">{{ listTime(c.lastMessage.created_at) }}</span>
            </div>
            <p class="truncate text-[13px]" :class="c.unread ? 'font-medium text-ink-800' : 'text-ink-muted2'">
              {{ c.lastMessage.direction === 'outbound' ? 'You: ' : '' }}{{ previewText(c.lastMessage) }}
            </p>
            <div v-if="myLabelsByKey[c.key]?.length" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="lid in myLabelsByKey[c.key]"
                :key="lid"
                class="rounded-pill px-1.5 py-px text-[10px] font-medium text-white"
                :style="{ backgroundColor: labels.find((l) => l.id === lid)?.color }"
              >
                {{ labels.find((l) => l.id === lid)?.name }}
              </span>
            </div>
          </div>
          <span v-if="c.unread" class="mt-2 h-[9px] w-[9px] shrink-0 rounded-full bg-brand" />
          </button>
        </div>
      </div>
    </div>

    <!-- Filter bottom sheet -->
    <div v-if="filterSheetOpen" class="absolute inset-0 z-40 flex items-end bg-black/30" @click="filterSheetOpen = false">
      <div class="w-full rounded-t-card border-t border-line bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]" @click.stop>
        <p class="mb-3 text-[13px] font-[600] text-ink-900">Filter conversations</p>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="flex items-center justify-between rounded-ctl px-3 py-2.5 text-left text-[14px]"
            :class="unreadOnly ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            @click="unreadOnly = !unreadOnly"
          >
            Unread
            <svg v-if="unreadOnly" viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 5" /></svg>
          </button>
          <button
            type="button"
            class="flex items-center justify-between rounded-ctl px-3 py-2.5 text-left text-[14px]"
            :class="replyFilter === 'awaiting_us' ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            @click="replyFilter = replyFilter === 'awaiting_us' ? 'all' : 'awaiting_us'"
          >
            Awaiting us
            <svg v-if="replyFilter === 'awaiting_us'" viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 5" /></svg>
          </button>
          <button
            type="button"
            class="flex items-center justify-between rounded-ctl px-3 py-2.5 text-left text-[14px]"
            :class="replyFilter === 'awaiting_patient' ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            @click="replyFilter = replyFilter === 'awaiting_patient' ? 'all' : 'awaiting_patient'"
          >
            Awaiting patient
            <svg v-if="replyFilter === 'awaiting_patient'" viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 5" /></svg>
          </button>
          <div v-if="labels.length > 0" class="my-1.5 border-t border-line-divider" />
          <button
            v-for="l in labels"
            :key="l.id"
            type="button"
            class="flex items-center gap-2.5 rounded-ctl px-3 py-2.5 text-left text-[14px]"
            :class="labelFilter === l.id ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            @click="labelFilter = labelFilter === l.id ? null : l.id"
          >
            <span class="h-[9px] w-[9px] shrink-0 rounded-full" :style="{ backgroundColor: l.color }" />
            <span class="flex-1 truncate">{{ l.name }}</span>
            <svg v-if="labelFilter === l.id" viewBox="0 0 16 16" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 5" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Thread: overlay shown while open or animating closed via the back gesture -->
    <div
      v-if="selectedKey || swipeBack.active.value"
      ref="threadEl"
      class="absolute inset-0 z-30 flex min-h-0 flex-col bg-surface-page shadow-[-2px_0_12px_rgba(0,0,0,0.12)]"
      :style="{
        transform: `translateX(${swipeBack.dragX.value}px)`,
        transition: swipeBack.dragging.value ? 'none' : 'transform 200ms ease-out',
        paddingBottom: keyboardHeight + 'px',
      }"
    >
      <template v-if="selected">
      <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-brand-text" @click="selectedKey = null">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-[600] text-ink-900">{{ selected.name }}</p>
          <p class="truncate text-[12px] text-ink-muted2">
            <span v-if="selected.channel === 'whatsapp'" class="rounded-pill bg-[#25D366]/10 px-1.5 py-px font-medium text-[#128C4B]">WhatsApp</span>
            <span v-else class="rounded-pill bg-brand-tint px-1.5 py-px font-medium text-brand-text">In-app</span>
            <span v-if="selected.phoneNumber" class="ml-1.5">{{ selected.phoneNumber }}</span>
          </p>
        </div>
      </div>

      <div ref="messagesEl" class="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <div v-for="m in thread" :key="m.id" class="flex" :class="m.direction === 'outbound' ? 'justify-end' : 'justify-start'">
          <div
            class="max-w-[80%] rounded-card px-[8px] py-[6px] shadow-card"
            :class="[
              m.direction === 'outbound' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900',
              m.status === 'failed' && 'cursor-pointer',
            ]"
            @click="m.status === 'failed' && retryMessage(m)"
          >
            <img
              v-if="m.media_type === 'image' && m.media_storage_path && mediaUrls[m.media_storage_path]"
              :src="mediaUrls[m.media_storage_path]"
              class="max-w-full rounded-ctl"
              @click.stop="lightboxUrl = mediaUrls[m.media_storage_path]"
            />
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
            <p v-else-if="m.media_type" class="text-[12.5px] italic opacity-70">{{ m.pending ? 'Uploading…' : 'Media unavailable' }}</p>

            <!-- Text (or a caption/template fallback) carries its own trailing
                 time+status inline, WhatsApp-style: same line as the last word
                 whenever there's room, wrapping below only if there isn't.
                 Media with no text/caption has nothing to attach that to, so
                 it falls back to its own line under it. -->
            <p v-if="bubbleText(m)" class="whitespace-pre-wrap text-[13.5px]" :class="m.media_type && 'mt-1'">
              {{ bubbleText(m) }}
              <span
                class="ml-1.5 inline-flex translate-y-[2px] items-center gap-1 whitespace-nowrap text-[10.5px]"
                :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'"
              >
                <span v-if="m.status === 'failed'" class="underline">Tap to retry</span>
                <span v-else>{{ shortTime(m.created_at) }}</span>
                <InboxMessageStatus v-if="m.direction === 'outbound'" :status="m.status" />
              </span>
            </p>
            <p v-else class="mt-1 flex items-center justify-end gap-1.5 text-right text-[10.5px]" :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'">
              <span v-if="m.status === 'failed'" class="underline">Tap to retry</span>
              <span v-else>{{ shortTime(m.created_at) }}</span>
              <InboxMessageStatus v-if="m.direction === 'outbound'" :status="m.status" />
            </p>
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-line bg-surface p-3">
        <p v-if="sendError" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
        <p v-if="!within24h" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text">
          More than 24h since {{ selected.name }} last messaged — free-form replies are blocked by WhatsApp.
        </p>
        <div v-else-if="audioRecording" class="flex items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2.5">
          <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
          <span class="flex-1 text-[14px] text-ink-700">Recording… {{ recordingLabel(audioSeconds) }}</span>
          <button type="button" class="shrink-0 px-1.5 text-[12.5px] text-ink-faint" @click="cancelAudioRecording">Cancel</button>
          <UiBtn variant="primary" size="sm" @click="toggleAudioRecording">Send</UiBtn>
        </div>
        <div v-else class="flex items-end gap-2">
          <InboxSavedRepliesPicker size="lg" @insert="insertReply" />
          <input ref="fileInput" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" class="hidden" @change="onFileChosen" />
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            title="Attach a file"
            @click="fileInput?.click()"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M8 2.5v11M2.5 8h11" />
            </svg>
          </button>
          <!-- No visible Send button -- Enter on a hardware keyboard already
               sends (see the handler below); enterkeyhint swaps the virtual
               keyboard's own return key to a "Send" label so the native
               keyboard button does the same job, same as iMessage/WhatsApp. -->
          <textarea
            ref="composerTextarea"
            v-model="composerText"
            rows="1"
            enterkeyhint="send"
            placeholder="Type a message…"
            class="max-h-24 min-h-11 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
            @keydown.enter.exact.prevent="sendText"
          />
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChosen" />
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            title="Take a photo"
            @click="cameraInput?.click()"
          >
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.2l.5-1h5.6l.5 1h1.2A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6Z" stroke-linejoin="round" />
              <circle cx="8" cy="8.2" r="2.3" />
            </svg>
          </button>
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            title="Record a voice note"
            @click="toggleAudioRecording"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
              <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
      </template>
    </div>

    <div v-if="lightboxUrl" class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" @click="lightboxUrl = null">
      <img :src="lightboxUrl" class="max-h-full max-w-full rounded-ctl object-contain" @click.stop />
      <div class="absolute right-4 flex gap-2" style="top: calc(env(safe-area-inset-top) + 12px)">
        <a :href="lightboxUrl" download target="_blank" class="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" title="Download" @click.stop>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <button type="button" class="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" title="Close" @click="lightboxUrl = null">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M3 3l10 10M13 3 3 13" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
