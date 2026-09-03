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
  pending?: boolean
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
const webPush = useWebPush()
const t = useT()
const pushBannerDismissed = ref(false)

// Messages this tab has sent but the server hasn't confirmed into the real
// table yet -- rendered inline with a clock icon so the composer clears and
// the message appears immediately (WhatsApp-style) instead of waiting on
// the round trip. load() naturally supersedes one once the real row shows
// up in `messages`; on failure it's kept and flipped to a failed status
// instead of vanishing.
const pendingMessages = ref<Message[]>([])

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

// Per-user archive + label assignment, unlike readTimestamps above -- these
// two are private per team member (see the whatsapp_conversation_archives/
// whatsapp_conversation_labels migration comments), while the label
// *catalog* itself (whatsapp_labels) is shared account-wide so the whole
// team draws from one consistent name/color vocabulary.
interface LabelDef {
  id: string
  name: string
  color: string
}
const archivedKeys = ref<Set<string>>(new Set())
const myLabelsByKey = ref<Record<string, string[]>>({})
const labels = ref<LabelDef[]>([])
async function loadArchivesAndLabels() {
  if (!store.teamMember) return
  const [{ data: archives }, { data: assigns }, { data: labelRows }] = await Promise.all([
    supabase.from('whatsapp_conversation_archives').select('conversation_key').eq('team_member_id', store.teamMember.id),
    supabase.from('whatsapp_conversation_labels').select('conversation_key, label_id').eq('team_member_id', store.teamMember.id),
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
      .limit(1000),
    supabase.from('patient_app_messages').select('id, patient_id, direction, body, created_at').order('created_at', { ascending: false }).limit(1000),
  ])
  // Normalized into the same Message shape so the rest of this page (thread
  // grouping, unread, delete, ticks) doesn't need to know two tables exist --
  // in-app messages just have no phone/media/template/wamid fields.
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

// Pending messages count toward "last message" previews and the thread,
// but never toward unread state (they're mine, outbound) -- combining them
// here rather than in `messages` itself keeps `messages` as strictly "what
// the server has," which load() can keep replacing wholesale without
// needing to know pending messages exist.
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
    const last = msgs[0] // messages already ordered desc
    list.push({
      key,
      patientId: last.patient_id,
      phoneNumber: last.phone_number,
      name: (last.patient_id && patientNames.value[last.patient_id]) || last.phone_number || t('Unknown', 'Desconocido'),
      channel: last.channel,
      lastMessage: last,
      unread: last.direction === 'inbound' && (!readTimestamps.value[key] || readTimestamps.value[key] < last.created_at),
    })
  }
  return list.sort((a, b) => b.lastMessage!.created_at.localeCompare(a.lastMessage!.created_at))
})

// Search matches name, phone number, and anything said in the conversation
// -- not just the last message -- so finding "that time they mentioned X"
// works the same as finding a patient by name or number.
const conversationSearchText = computed(() => {
  const map: Record<string, string> = {}
  for (const m of allMessages.value) {
    const key = m.patient_id ?? m.phone_number ?? 'unknown'
    map[key] = `${map[key] ?? ''} ${m.body_preview ?? ''}`
  }
  return map
})
// Archived view: toggled by a single icon button rather than a filter chip,
// since it's a whole different list (not a narrowing of the active one) --
// compose/"+ New" doesn't make sense there either, see the template.
const view = ref<'active' | 'archived'>('active')
const unreadOnly = ref(false)
// "awaiting_us"/"awaiting_patient" is deliberately independent from unread:
// unread means "I haven't opened this," awaiting-us means "the last message
// is theirs, regardless of whether I've read it" -- a conversation I've
// already read but haven't replied to is exactly the case this filter
// exists to surface that "unread" alone would miss.
const replyFilter = ref<'all' | 'awaiting_us' | 'awaiting_patient'>('all')
const labelFilter = ref<string | null>(null)

const filteredConversations = computed(() => {
  let list = conversations.value.filter((c) => archivedKeys.value.has(c.key) === (view.value === 'archived'))
  if (search.value.trim()) {
    const q = normalizeSearchTerm(search.value.trim())
    list = list.filter((c) => normalizeSearchTerm(`${c.name} ${c.phoneNumber ?? ''} ${conversationSearchText.value[c.key] ?? ''}`).includes(q))
  }
  if (unreadOnly.value) list = list.filter((c) => c.unread)
  if (replyFilter.value === 'awaiting_us') list = list.filter((c) => c.lastMessage?.direction === 'inbound')
  else if (replyFilter.value === 'awaiting_patient') list = list.filter((c) => c.lastMessage?.direction === 'outbound')
  if (labelFilter.value) list = list.filter((c) => myLabelsByKey.value[c.key]?.includes(labelFilter.value!))
  return list
})

// Bulk select: "Select" enters the mode, clicking rows checks them, then
// mark-unread or delete applies to everything checked at once.
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
function onRowClick(c: Conversation) {
  if (selectionMode.value) {
    toggleSelectKey(c.key)
    return
  }
  selectConversation(c)
}

const selectedKey = ref<string | null>(null)
// A brand-new conversation started via "New message" has no rows in
// `whatsapp_messages` yet, so it can't come from the `conversations` list --
// it lives here until the first template send lands it in the real table.
const draftConversation = ref<Conversation | null>(null)
const selected = computed(
  () => conversations.value.find((c) => c.key === selectedKey.value) ?? (draftConversation.value?.key === selectedKey.value ? draftConversation.value : null),
)
const thread = computed(() =>
  selectedKey.value ? allMessages.value.filter((m) => (m.patient_id ?? m.phone_number ?? 'unknown') === selectedKey.value).slice().reverse() : [],
)

// Auto-scroll, WhatsApp-style: snap to the bottom when a conversation is
// opened, and keep following new messages only while already at the bottom
// -- scrolling up to read history shouldn't get yanked back down by an
// incoming message. That case (and any message sent/received while
// scrolled up) surfaces the floating "jump to latest" button instead.
const threadScrollEl = ref<HTMLElement | null>(null)
const showJumpToLatest = ref(false)

function isThreadNearBottom(threshold = 120) {
  const el = threadScrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}
function scrollThreadToBottom(smooth = false) {
  const el = threadScrollEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}
// nextTick alone lands a few pixels short -- it resolves once Vue has
// patched the DOM, but the browser hasn't necessarily run layout yet, so
// el.scrollHeight can still reflect the pre-update height. Waiting a frame
// after nextTick gives layout a chance to catch up first.
function scrollThreadToBottomNextFrame(smooth = false) {
  nextTick(() => requestAnimationFrame(() => scrollThreadToBottom(smooth)))
}
function onThreadScroll() {
  showJumpToLatest.value = !isThreadNearBottom()
}
function jumpToLatest() {
  scrollThreadToBottomNextFrame(true)
  showJumpToLatest.value = false
}

watch(selectedKey, () => {
  showJumpToLatest.value = false
  scrollThreadToBottomNextFrame(false)
})
watch(thread, () => {
  const wasNearBottom = isThreadNearBottom()
  const isOwnSend = thread.value.at(-1)?.direction === 'outbound'
  if (wasNearBottom || isOwnSend) {
    scrollThreadToBottomNextFrame(true)
  } else {
    showJumpToLatest.value = true
  }
})

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

// Clicking a push notification lands here with ?open=<conversation key> --
// waits for the list to finish loading (the key won't match anything
// before then) and opens that thread once, the same way a manual click on
// the row would. Without this, the notification just opened the Inbox at
// its default "pick a conversation" state, landing nowhere near what
// triggered it.
const route = useRoute()
let openedFromNotification = false
watch(
  [conversations, loading],
  () => {
    if (openedFromNotification || loading.value) return
    openedFromNotification = true
    const key = route.query.open
    if (typeof key !== 'string') return
    const match = conversations.value.find((c) => c.key === key)
    if (match) selectConversation(match)
  },
  { immediate: true },
)

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
      if (store.accountId) await supabase.from('whatsapp_conversation_reads').delete().eq('account_id', store.accountId).eq('conversation_key', key)
      // RLS on these two only lets each user delete their own rows, so this
      // only ever cleans up the deleting user's own archive/label state for
      // the key -- any teammate's rows on the same (now-gone) conversation
      // are left as harmless orphans (cheap, PK-only dead rows) rather than
      // needing a security-definer cleanup path for what should be rare.
      if (store.teamMember) {
        await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', store.teamMember.id).eq('conversation_key', key)
        await supabase.from('whatsapp_conversation_labels').delete().eq('team_member_id', store.teamMember.id).eq('conversation_key', key)
      }
    }
    messages.value = messages.value.filter((m) => !keys.includes(m.patient_id ?? m.phone_number ?? 'unknown'))
    pendingMessages.value = pendingMessages.value.filter((m) => !keys.includes(m.patient_id ?? m.phone_number ?? 'unknown'))
    if (selectedKey.value && keys.includes(selectedKey.value)) selectedKey.value = null
  } finally {
    deletingConversation.value = false
  }
}
async function deleteConversation() {
  if (!selected.value || !selectedKey.value) return
  if (!confirm(`${t('Delete this whole conversation with', 'Eliminar toda la conversación con')} ${selected.value.name}${t('? This removes all messages and can\'t be undone.', '? Esto elimina todos los mensajes y no se puede deshacer.')}`)) return
  await deleteKeys([selectedKey.value])
}
async function bulkDeleteSelected() {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  const convWord = keys.length > 1 ? t('conversations', 'conversaciones') : t('conversation', 'conversación')
  if (!confirm(`${t('Delete', 'Eliminar')} ${keys.length} ${convWord}${t('? This removes all their messages and can\'t be undone.', '? Esto elimina todos sus mensajes y no se puede deshacer.')}`)) return
  await deleteKeys(keys)
  exitSelectionMode()
}
async function bulkMarkUnreadSelected() {
  const past = new Date(0).toISOString()
  for (const key of selectedKeys.value) {
    readTimestamps.value = { ...readTimestamps.value, [key]: past }
    if (store.accountId) await supabase.from('whatsapp_conversation_reads').upsert({ account_id: store.accountId, conversation_key: key, last_read_at: past } as never)
  }
  exitSelectionMode()
}

async function bulkArchiveSelected(archive: boolean) {
  const keys = [...selectedKeys.value]
  if (keys.length === 0 || !store.teamMember || !store.accountId) return
  if (archive) {
    const next = new Set(archivedKeys.value)
    for (const k of keys) next.add(k)
    archivedKeys.value = next
    await supabase
      .from('whatsapp_conversation_archives')
      .upsert(keys.map((k) => ({ account_id: store.accountId!, team_member_id: store.teamMember!.id, conversation_key: k })) as never)
  } else {
    const next = new Set(archivedKeys.value)
    for (const k of keys) next.delete(k)
    archivedKeys.value = next
    await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', store.teamMember.id).in('conversation_key', keys)
  }
  exitSelectionMode()
}

// Single-conversation archive toggle, used from the thread header.
async function toggleArchiveSelected(key: string) {
  if (!store.teamMember || !store.accountId) return
  const isArchived = archivedKeys.value.has(key)
  const next = new Set(archivedKeys.value)
  if (isArchived) next.delete(key)
  else next.add(key)
  archivedKeys.value = next
  if (isArchived) {
    await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', store.teamMember.id).eq('conversation_key', key)
  } else {
    await supabase
      .from('whatsapp_conversation_archives')
      .upsert({ account_id: store.accountId, team_member_id: store.teamMember.id, conversation_key: key } as never)
  }
}

// Shared by the thread-header LabelPicker (one conversation) and the bulk
// bar's LabelPicker (a whole selection) -- both just need "toggle this
// label for these keys," they differ only in how many keys that is.
async function toggleLabelForKeys(labelId: string, keys: string[]) {
  if (!store.teamMember || !store.accountId || keys.length === 0) return
  // "Applied to all" toggles off for all; anything less than that (none, or
  // a mixed bulk selection) toggles on for whichever don't have it yet --
  // matches the checkbox convention used elsewhere (e.g. patient tag lists)
  // where a partially-applied state fills in rather than clearing first.
  const allApplied = keys.every((k) => myLabelsByKey.value[k]?.includes(labelId))
  const nextByKey = { ...myLabelsByKey.value }
  if (allApplied) {
    for (const k of keys) nextByKey[k] = (nextByKey[k] ?? []).filter((id) => id !== labelId)
    myLabelsByKey.value = nextByKey
    await supabase.from('whatsapp_conversation_labels').delete().eq('team_member_id', store.teamMember.id).eq('label_id', labelId).in('conversation_key', keys)
  } else {
    const toAdd = keys.filter((k) => !myLabelsByKey.value[k]?.includes(labelId))
    for (const k of toAdd) nextByKey[k] = [...(nextByKey[k] ?? []), labelId]
    myLabelsByKey.value = nextByKey
    await supabase
      .from('whatsapp_conversation_labels')
      .upsert(toAdd.map((k) => ({ account_id: store.accountId!, team_member_id: store.teamMember!.id, conversation_key: k, label_id: labelId })) as never)
  }
}

async function createLabel(name: string, color: string, applyToKeys: string[]) {
  if (!store.accountId) return
  const { data } = await supabase.from('whatsapp_labels').insert({ account_id: store.accountId, name, color, created_by: store.teamMember?.id ?? null }).select('id, name, color').single()
  if (!data) return
  labels.value = [...labels.value, data].sort((a, b) => a.name.localeCompare(b.name))
  if (applyToKeys.length > 0) await toggleLabelForKeys(data.id, applyToKeys)
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

// Which channel a reply goes out on: whatever the most recent message in
// the thread used. In-app has no 24h session-window restriction (that's a
// WhatsApp-specific rule) and staff can't cold-start one -- a patient has
// to have sent at least one in-app message first -- so an empty thread
// (a brand-new conversation from "+ New") always defaults to whatsapp.
const replyChannel = computed(() => (thread.value.length === 0 ? 'whatsapp' : thread.value[thread.value.length - 1].channel))
const within24h = computed(() => {
  if (replyChannel.value === 'in_app') return true
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound' && m.channel === 'whatsapp').at(-1)
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
      await useStaffFetch('/api/patient-messages/send', { method: 'POST', body: { patientId: target.patientId, text } })
    } else {
      await useStaffFetch('/api/whatsapp/inbox-send', {
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
    sendError.value = err?.data?.statusMessage ?? t('Failed to send', 'Error al enviar')
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
    await useStaffFetch('/api/whatsapp/inbox-send', {
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
    sendError.value = err?.data?.statusMessage ?? t('Failed to send', 'Error al enviar')
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
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !selected.value) return
  if (file.size > MAX_MEDIA_BYTES) {
    sendError.value = t('File is too large (max 16 MB).', 'El archivo es demasiado grande (máx. 16 MB).')
    return
  }
  const kind = mediaKindForFile(file)
  if (kind === 'image') {
    try {
      const { blob, mimeType } = await normalizeImageForWhatsApp(file)
      const base64 = await blobToBase64(blob)
      await sendMedia(base64, mimeType, file.name.replace(/\.\w+$/, '.jpg'), 'image')
    } catch (err: any) {
      sendError.value = err?.message ?? t('Could not process this image.', 'No se pudo procesar esta imagen.')
    }
  } else {
    const base64 = await blobToBase64(file)
    await sendMedia(base64, file.type, file.name, kind)
  }
  if (fileInput.value) fileInput.value.value = ''
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
      sendError.value = t('Could not access the microphone -- check your browser permissions.', 'No se pudo acceder al micrófono; comprueba los permisos del navegador.')
    }
  }
}

// Fullscreen viewer for tapping any image in the thread (mine or theirs) --
// mediaUrls' signed URL already works as a direct download link.
const lightboxUrl = ref<string | null>(null)
function recordingLabel(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function onTemplateSent() {
  templateModalOpen.value = false
  draftConversation.value = null
  load()
}

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
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
function relativeDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diffDays = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
const MEDIA_TYPE_LABELS: Record<string, [string, string]> = {
  image: ['Image', 'Imagen'],
  video: ['Video', 'Vídeo'],
  audio: ['Audio', 'Audio'],
  document: ['Document', 'Documento'],
  sticker: ['Sticker', 'Sticker'],
}
function mediaTypeLabel(mediaType: string): string {
  const pair = MEDIA_TYPE_LABELS[mediaType]
  if (pair) return t(pair[0], pair[1])
  return `${mediaType[0].toUpperCase()}${mediaType.slice(1)}`
}
function previewText(m: Message) {
  if (m.media_type) return `${mediaTypeLabel(m.media_type)}${m.body_preview ? ` — ${m.body_preview}` : ''}`
  if (m.template_name) return m.body_preview ?? `${t('Template', 'Plantilla')}: ${m.template_name}`
  return m.body_preview ?? '—'
}
// What actually renders as the bubble's text, distinct from previewText
// (used only for the conversation-list row) -- empty for media with no
// caption, since there's nothing to attach the inline time+status to.
function bubbleText(m: Message): string {
  if (m.media_type) return m.body_preview ?? ''
  if (m.template_name) return m.body_preview ?? `${t('Template', 'Plantilla')}: ${m.template_name}`
  return m.body_preview ?? ''
}

// Live updates: new inbound/outbound messages land without a manual refresh.
let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, () => load())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, () => load())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `account_id=eq.${store.accountId}` }, () => load())
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})

// A second, coarser channel for the new per-user/shared inbox-organization
// tables -- unlike whatsapp_messages there's no per-second urgency here, so
// any change on any of the three just reloads all three rather than trying
// to patch state precisely. Catches another of this user's own tabs/devices
// changing something, and a teammate adding a new shared label.
let orgChannel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  orgChannel = supabase
    .channel('inbox-organization')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_labels', filter: `account_id=eq.${store.accountId}` }, () => loadArchivesAndLabels())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversation_labels', filter: `account_id=eq.${store.accountId}` }, () => loadArchivesAndLabels())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversation_archives', filter: `account_id=eq.${store.accountId}` }, () => loadArchivesAndLabels())
    .subscribe()
})
onUnmounted(() => {
  if (orgChannel) supabase.removeChannel(orgChannel)
})

// Belt-and-suspenders alongside the realtime subscription above -- a
// websocket that silently drops (backgrounded tab, network blip) leaves the
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
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Inbox', 'Bandeja de entrada')" />
    <div v-if="webPush.supported.value && webPush.permission.value === 'default' && !pushBannerDismissed" class="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-brand-tint px-4 py-2">
      <p class="text-[12.5px] text-brand-text">{{ t('Get notified here when a patient messages you, even with the tab in the background.', 'Recibe avisos aquí cuando un paciente te escriba, incluso con la pestaña en segundo plano.') }}</p>
      <div class="flex shrink-0 items-center gap-3">
        <UiBtn variant="primary" size="sm" @click="webPush.register()">{{ t('Enable notifications', 'Activar notificaciones') }}</UiBtn>
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="pushBannerDismissed = true">{{ t('Not now', 'Ahora no') }}</button>
      </div>
    </div>
    <div class="flex flex-1 overflow-hidden">
      <!-- Conversation list -->
      <div class="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div class="border-b border-line-divider p-3">
          <div v-if="!selectionMode" class="flex items-center gap-2">
            <input
              v-model="search"
              type="search"
              :placeholder="t('Search name, number, messages…', 'Buscar nombre, número, mensajes…')"
              class="h-8 w-full flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border"
              :class="view === 'archived' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
              :title="view === 'archived' ? t('Show active conversations', 'Mostrar conversaciones activas') : t('Show archived conversations', 'Mostrar conversaciones archivadas')"
              @click="view = view === 'archived' ? 'active' : 'archived'"
            >
              <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 3.5h12v2.5H2z" />
                <path d="M2.8 6v6.5a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V6" />
                <path d="M6.5 8.5h3" />
              </svg>
            </button>
            <button type="button" class="shrink-0 text-[12.5px] text-ink-faint hover:text-ink-muted" @click="selectionMode = true">{{ t('Select', 'Seleccionar') }}</button>
            <div v-if="view === 'active'" ref="composeEl" class="relative shrink-0">
              <UiBtn variant="primary" size="sm" @click="composeOpen = !composeOpen">{{ t('+ New', '+ Nuevo') }}</UiBtn>
              <div v-if="composeOpen" class="absolute right-0 top-[calc(100%+4px)] z-20 w-64 rounded-card border border-line bg-surface p-2 shadow-popover">
                <input
                  v-model="composeQuery"
                  type="text"
                  autofocus
                  :placeholder="t('Search patients…', 'Buscar pacientes…')"
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
                  <li v-if="filteredComposePatients.length === 0" class="px-2 py-1.5 text-[13px] text-ink-faint">{{ t('No matches', 'Sin coincidencias') }}</li>
                </ul>
              </div>
            </div>
          </div>
          <div v-else class="flex items-center justify-between gap-2">
            <p class="text-[12.5px] text-ink-700">{{ selectedKeys.size }} {{ t('selected', 'seleccionados') }}</p>
            <div class="flex items-center gap-3">
              <InboxLabelPicker
                :labels="labels"
                :applied-ids="[]"
                @toggle-label="(id: string) => toggleLabelForKeys(id, [...selectedKeys])"
                @create-label="(name: string, color: string) => createLabel(name, color, [...selectedKeys])"
              />
              <button
                type="button"
                class="text-[12.5px] text-brand-text hover:underline disabled:opacity-40"
                :disabled="selectedKeys.size === 0"
                @click="bulkArchiveSelected(view !== 'archived')"
              >
                {{ view === 'archived' ? t('Unarchive', 'Desarchivar') : t('Archive', 'Archivar') }}
              </button>
              <button type="button" class="text-[12.5px] text-brand-text hover:underline disabled:opacity-40" :disabled="selectedKeys.size === 0" @click="bulkMarkUnreadSelected">{{ t('Mark unread', 'Marcar como no leído') }}</button>
              <button type="button" class="text-[12.5px] text-danger-text hover:underline disabled:opacity-40" :disabled="selectedKeys.size === 0" @click="bulkDeleteSelected">{{ t('Delete', 'Eliminar') }}</button>
              <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="exitSelectionMode">{{ t('Cancel', 'Cancelar') }}</button>
            </div>
          </div>
          <div v-if="!selectionMode" class="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="flex h-7 items-center gap-1 rounded-pill border px-2.5 text-[12px] font-medium"
              :class="unreadOnly ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
              @click="unreadOnly = !unreadOnly"
            >
              {{ t('Unread', 'No leídos') }}
            </button>
            <button
              type="button"
              class="flex h-7 items-center gap-1 rounded-pill border px-2.5 text-[12px] font-medium"
              :class="replyFilter === 'awaiting_us' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
              @click="replyFilter = replyFilter === 'awaiting_us' ? 'all' : 'awaiting_us'"
            >
              {{ t('Awaiting us', 'Esperando respuesta nuestra') }}
            </button>
            <button
              type="button"
              class="flex h-7 items-center gap-1 rounded-pill border px-2.5 text-[12px] font-medium"
              :class="replyFilter === 'awaiting_patient' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
              @click="replyFilter = replyFilter === 'awaiting_patient' ? 'all' : 'awaiting_patient'"
            >
              {{ t('Awaiting patient', 'Esperando respuesta del paciente') }}
            </button>
            <InboxLabelFilterPicker v-model="labelFilter" :labels="labels" />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
          <p v-else-if="filteredConversations.length === 0" class="p-6 text-center text-[13px] text-ink-faint">
            {{ view === 'archived' ? t('No archived conversations.', 'No hay conversaciones archivadas.') : t('No conversations yet.', 'Aún no hay conversaciones.') }}
          </p>
          <button
            v-for="c in filteredConversations"
            :key="c.key"
            type="button"
            class="flex w-full items-start gap-2.5 border-b border-line-row px-3 py-2.5 text-left hover:bg-surface-subtle"
            :class="selectedKey === c.key && !selectionMode ? 'bg-brand-tint' : ''"
            @click="onRowClick(c)"
          >
            <span
              v-if="selectionMode"
              class="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
              :class="selectedKeys.has(c.key) ? 'border-brand bg-brand' : 'border-line-control bg-surface'"
            >
              <svg v-if="selectedKeys.has(c.key)" viewBox="0 0 16 16" class="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 8l3.5 3.5L13 5" />
              </svg>
            </span>
            <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
              {{ c.name.slice(0, 2).toUpperCase() }}
              <span v-if="c.channel === 'whatsapp'" class="absolute -bottom-0.5 -right-0.5 flex h-[13px] w-[13px] items-center justify-center rounded-full border border-surface bg-[#25D366]" :title="t('WhatsApp', 'WhatsApp')">
                <svg viewBox="0 0 24 24" class="h-[8px] w-[8px] fill-white"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.4-.1.2-.3.4-.4.5-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.5 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z" /></svg>
              </span>
              <span v-else class="absolute -bottom-0.5 -right-0.5 flex h-[13px] w-[13px] items-center justify-center rounded-full border border-surface bg-brand" :title="t('In-app message', 'Mensaje en la app')">
                <svg viewBox="0 0 24 24" class="h-[8px] w-[8px] fill-white"><path d="M4 4h16v12H7l-3 3z" /></svg>
              </span>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-[13px] font-[560]" :class="c.unread ? 'text-ink-900' : 'text-ink-700'">
                  {{ c.name }}
                  <span v-if="c.phoneNumber && c.patientId" class="font-normal text-ink-faint">{{ c.phoneNumber }}</span>
                </p>
                <span class="shrink-0 text-[11px] text-ink-faint">{{ listTime(c.lastMessage!.created_at) }}</span>
              </div>
              <p class="truncate text-[12px]" :class="c.unread ? 'font-medium text-ink-800' : 'text-ink-muted2'">
                {{ c.lastMessage!.direction === 'outbound' ? t('You: ', 'Tú: ') : '' }}{{ previewText(c.lastMessage!) }}
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
            <span v-if="c.unread" class="mt-1 h-[8px] w-[8px] shrink-0 rounded-full bg-brand" />
          </button>
        </div>
      </div>

      <!-- Thread -->
      <div v-if="!selected" class="flex flex-1 items-center justify-center text-[13px] text-ink-faint">
        {{ t('Select a conversation to view messages.', 'Selecciona una conversación para ver los mensajes.') }}
      </div>
      <div v-else class="flex min-w-0 flex-1 flex-col bg-surface-page">
        <div class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
            {{ selected.name.slice(0, 2).toUpperCase() }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] font-[600] text-ink-900">{{ selected.name }}</p>
            <p class="truncate text-[11.5px] text-ink-muted2">
              <span v-if="selected.channel === 'whatsapp'" class="rounded-pill bg-[#25D366]/10 px-1.5 py-px font-medium text-[#128C4B]">{{ t('WhatsApp', 'WhatsApp') }}</span>
              <span v-else class="rounded-pill bg-brand-tint px-1.5 py-px font-medium text-brand-text">{{ t('In-app', 'En la app') }}</span>
              <span v-if="selected.phoneNumber" class="ml-1.5">{{ selected.phoneNumber }}</span>
            </p>
          </div>
          <NuxtLink v-if="selected.patientId" :to="`/patients/${selected.patientId}`" class="shrink-0 text-[12.5px] text-brand-text hover:text-brand-hover">
            {{ t('View patient →', 'Ver paciente →') }}
          </NuxtLink>
          <InboxLabelPicker
            v-if="!isNewConversation"
            :labels="labels"
            :applied-ids="myLabelsByKey[selected.key] ?? []"
            @toggle-label="(id: string) => toggleLabelForKeys(id, [selected!.key])"
            @create-label="(name: string, color: string) => createLabel(name, color, [selected!.key])"
          />
          <button
            v-if="!isNewConversation"
            type="button"
            class="shrink-0 text-[12.5px] text-ink-muted hover:text-ink-700"
            @click="toggleArchiveSelected(selected!.key)"
          >
            {{ archivedKeys.has(selected!.key) ? 'Unarchive' : 'Archive' }}
          </button>
          <button
            v-if="!isNewConversation"
            type="button"
            class="shrink-0 text-[12.5px] text-danger-text hover:underline disabled:opacity-50"
            :disabled="deletingConversation"
            @click="deleteConversation"
          >
            {{ t('Delete conversation', 'Eliminar conversación') }}
          </button>
        </div>

        <div class="relative min-h-0 flex-1">
          <div ref="threadScrollEl" class="h-full space-y-3 overflow-y-auto px-4 py-4" @scroll="onThreadScroll">
          <template v-for="(m, i) in thread" :key="m.id">
            <div
              v-if="i === 0 || relativeDay(m.created_at) !== relativeDay(thread[i - 1].created_at)"
              class="sticky top-0 z-10 -mx-4 flex justify-center bg-surface-page py-1.5"
            >
              <span class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-text">{{ relativeDay(m.created_at) }}</span>
            </div>
            <div class="flex" :class="m.direction === 'outbound' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[70%] rounded-card px-[8px] py-[6px] shadow-card"
                :class="[
                  m.direction === 'outbound' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900',
                  m.status === 'failed' && 'cursor-pointer',
                ]"
                @click="m.status === 'failed' && retryMessage(m)"
              >
                <img
                  v-if="m.media_type === 'image' && m.media_storage_path && mediaUrls[m.media_storage_path]"
                  :src="mediaUrls[m.media_storage_path]"
                  class="max-w-full cursor-pointer rounded-ctl"
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
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="shrink-0" aria-hidden="true">
                    <path d="M4 1.5h5.5L12.5 4.5V14.5H4z" stroke-linejoin="round" />
                    <path d="M9.5 1.5V4.5H12.5" stroke-linejoin="round" />
                  </svg>
                  {{ m.media_filename ?? t('Document', 'Documento') }}
                </a>
                <img
                  v-else-if="m.media_type === 'sticker' && m.media_storage_path && mediaUrls[m.media_storage_path]"
                  :src="mediaUrls[m.media_storage_path]"
                  class="h-24 w-24"
                />
                <p v-else-if="m.media_type" class="text-[12.5px] italic opacity-70">{{ m.pending ? t('Uploading…', 'Subiendo…') : t('Media unavailable', 'Contenido no disponible') }}</p>

                <!-- Text (or a caption/template fallback) carries its own trailing
                     time+status inline, WhatsApp-style: it sits on the same line
                     as the last word whenever there's room, wrapping below only
                     if there isn't. Media with no text/caption has nothing to
                     attach that to, so it falls back to its own line under it. -->
                <p v-if="bubbleText(m)" class="whitespace-pre-wrap text-[13px]" :class="m.media_type && 'mt-1'">
                  {{ bubbleText(m) }}
                  <span
                    class="ml-1.5 inline-flex translate-y-[2px] items-center gap-1 whitespace-nowrap text-[10.5px]"
                    :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'"
                  >
                    <span v-if="m.status === 'failed'" class="underline">{{ t('Tap to retry', 'Toca para reintentar') }}</span>
                    <span v-else>{{ shortTime(m.created_at) }}</span>
                    <InboxMessageStatus v-if="m.direction === 'outbound'" :status="m.status" />
                  </span>
                </p>
                <p v-else class="mt-1 flex items-center justify-end gap-1.5 text-right text-[10.5px]" :class="m.direction === 'outbound' ? 'text-white/70' : 'text-ink-faint'">
                  <span v-if="m.status === 'failed'" class="underline">{{ t('Tap to retry', 'Toca para reintentar') }}</span>
                  <span v-else>{{ shortTime(m.created_at) }}</span>
                  <InboxMessageStatus v-if="m.direction === 'outbound'" :status="m.status" />
                </p>
              </div>
            </div>
          </template>
          </div>

          <button
            v-if="showJumpToLatest"
            type="button"
            class="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-600 shadow-popover hover:bg-surface-subtle"
            :title="t('Jump to latest', 'Ir al último')"
            @click="jumpToLatest"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M3.5 6.5L8 11l4.5-4.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        <div class="shrink-0 border-t border-line bg-surface p-3">
          <p v-if="sendError" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
          <div v-if="!within24h" class="flex items-center justify-between gap-3 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2">
            <p class="text-[12.5px] text-warning-text">
              <template v-if="isNewConversation">{{ selected.name }} {{ t("hasn't messaged you before — start with an approved template.", 'no te ha escrito antes — comienza con una plantilla aprobada.') }}</template>
              <template v-else>{{ t('More than 24h since', 'Han pasado más de 24h desde que') }} {{ selected.name }} {{ t('last messaged — free-form replies are blocked by WhatsApp. Send a template instead.', 'escribió por última vez — WhatsApp bloquea las respuestas libres. Envía una plantilla en su lugar.') }}</template>
            </p>
            <UiBtn v-if="selected.patientId" variant="primary" size="sm" @click="templateModalOpen = true">{{ t('Send template', 'Enviar plantilla') }}</UiBtn>
          </div>
          <div v-else-if="audioRecording" class="flex items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2">
            <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
            <span class="flex-1 text-[13.5px] text-ink-700">{{ t('Recording…', 'Grabando…') }} {{ recordingLabel(audioSeconds) }}</span>
            <button type="button" class="shrink-0 text-[12.5px] text-ink-faint hover:text-ink-muted" @click="cancelAudioRecording">{{ t('Cancel', 'Cancelar') }}</button>
            <UiBtn variant="primary" size="sm" @click="toggleAudioRecording">{{ t('Send', 'Enviar') }}</UiBtn>
          </div>
          <div v-else class="flex items-end gap-2">
            <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle" :disabled="sending" @click="fileInput?.click()">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                <path d="M11.5 5.5L6.4 10.6a2 2 0 002.8 2.8l5.1-5.1a3.5 3.5 0 00-4.95-4.95L4.25 8.45a5 5 0 007.07 7.07" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <input ref="fileInput" type="file" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" @change="onFileChosen" />
            <button
              type="button"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle disabled:opacity-50"
              :disabled="sending"
              :title="t('Record a voice note', 'Grabar una nota de voz')"
              @click="toggleAudioRecording"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
                <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" stroke-linecap="round" />
              </svg>
            </button>
            <InboxSavedRepliesPicker @insert="insertReply" />
            <textarea
              ref="composerTextarea"
              v-model="composerText"
              rows="1"
              :placeholder="t('Type a message…', 'Escribe un mensaje…')"
              class="max-h-24 min-h-9 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none"
              @keydown.enter.exact.prevent="sendText"
            />
            <UiBtn variant="primary" :disabled="sending || !composerText.trim()" @click="sendText">{{ sending ? '…' : t('Send', 'Enviar') }}</UiBtn>
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

    <div v-if="lightboxUrl" class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" @click="lightboxUrl = null">
      <img :src="lightboxUrl" class="max-h-full max-w-full rounded-ctl object-contain" @click.stop />
      <div class="absolute right-4 top-4 flex gap-2">
        <a :href="lightboxUrl" download target="_blank" class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" :title="t('Download', 'Descargar')" @click.stop>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <button type="button" class="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" :title="t('Close', 'Cerrar')" @click="lightboxUrl = null">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M3 3l10 10M13 3 3 13" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
