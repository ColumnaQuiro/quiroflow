<script setup lang="ts">
import { snoozeStateOf, type SnoozeRow } from '../../utils/inboxSnooze'
import { replyWindowPill } from '../../utils/inboxReplyWindow'
import { reactionEmoji } from '../../utils/whatsappInbound'
import { fetchPatientAiDetails, latestHandoverReason, leadAiState, type InboxAiState } from '../../utils/inboxAiState'

const props = defineProps<{ accountId: string; teamMemberId: string; openConversationKey?: string | null }>()

interface Message {
  id: string
  patient_id: string | null
  phone_number: string | null
  /** Who the conversation is with when there is no phone -- an Instagram IGSID. */
  external_contact_id: string | null
  /** Set on a lead's message (somebody not yet a patient). */
  lead_id: string | null
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
  /** Sent by the AI receptionist on its own -- labelled for the team, never the patient. */
  sent_by_ai?: boolean
  /** The patient's WhatsApp reaction to this message, drawn on it (ReactionBadge). */
  contact_reaction?: string | null
  pending?: boolean
}
interface Conversation {
  key: string
  patientId: string | null
  phoneNumber: string | null
  /** Set instead of phoneNumber on a channel that has no phone, e.g. Instagram. */
  externalContactId: string | null
  /** A lead's own thread (Growth accounts only), keyed lead:<id>. */
  leadId: string | null
  name: string
  channel: string
  lastMessage: Message
  unread: boolean
  /** Snoozed by me and still out of sight, until then (inbox_snoozes). */
  snoozedUntil?: string | null
  /** A snooze of mine come due and not opened since: back on top, unread. */
  followUp?: boolean
}

const supabase = useSupabaseClient()
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const authedFetch = useAuthedFetch()
// The role's permissions and the account's entitlements. Read first: the
// receptionist's state below is loaded as soon as the list is.
const { can, restricted, context: staffContext } = usePractitionerContext()
// Whether this account has the AI receptionist (Growth, or bought on its
// own), as the web Inbox asks useGrowthTier: its banner, drafts and chips.
const hasReceptionist = computed(() => !!staffContext.value?.hasReceptionist)
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
// waiting on the round trip. Once the real row shows up in `messages` --
// often from the realtime INSERT, before the send has even answered -- it is
// drawn in the bubble's place under the bubble's key, so the clock just turns
// into a tick; on failure it's kept and flipped to a failed status instead of
// vanishing.
const pendingMessages = ref<(Message & { notBefore: string | null })[]>([])

// The bubble's key passes to the row it became, for good -- dropping the
// bubble must not change the key the row is drawn under, or it remounts
// (utils/inboxPendingMessages.ts).
const keptKeys = ref<Record<string, string>>({})
function settlePending(tempId: string, server: Message[]) {
  const rowId = matchPendingToServer(server, pendingMessages.value).get(tempId)
  if (rowId) keptKeys.value = { ...keptKeys.value, [rowId]: tempId }
  pendingMessages.value = pendingMessages.value.filter((m) => m.id !== tempId)
}

// The list is inbox_conversations (what the web Inbox lists) and, for a Growth
// account, its lead threads from /api/growth/conversations (what the web
// merges in). Messages are fetched only for a thread that is opened, into
// threadExtra, and a refresh brings only what is newer than it already has.
//
// It used to download the newest 500 WhatsApp and 500 in-app messages on
// every refresh -- every minute and after every message -- to draw previews
// the list already carries.
const summaries = ref<Conversation[]>([])
const threadExtra = ref<Message[]>([])
// Threads whose messages have been fetched: until then the thread shows a
// placeholder rather than an empty conversation, which would say "they have
// not written to you yet" about somebody who has.
const loadedThreads = ref<Set<string>>(new Set())
const MESSAGE_COLUMNS = 'id, patient_id, phone_number, external_contact_id, lead_id, direction, status, body_preview, template_name, media_type, media_storage_path, media_mime_type, media_filename, channel, created_at, sent_by_ai, contact_reaction'
const SUMMARY_LIMIT = 400
const patientNames = ref<Record<string, string>>({})
const loading = ref(true)
const readTimestamps = ref<Record<string, string>>({})
// Read status is each person's own (inbox_reads), the same as on the web:
// opening a conversation marks it read for me, not for the whole team.
async function loadReadTimestamps() {
  const { data } = await supabase.from('inbox_reads').select('conversation_key, last_read_at').eq('team_member_id', props.teamMemberId)
  const next: Record<string, string> = {}
  for (const r of data ?? []) next[r.conversation_key] = r.last_read_at
  readTimestamps.value = next
}
onMounted(loadReadTimestamps)
// "Mark as unread" writes the epoch, and that holds whoever wrote last -- the
// same rule as inbox_conversations.unread_for_me and the badge. Parsed rather
// than compared as text: the database hands it back as +00:00, not as Z.
function markedUnread(key: string) {
  const at = readTimestamps.value[key]
  return !!at && Date.parse(at) === 0
}

interface LabelDef { id: string; name: string; color: string }
const archivedKeys = ref<Set<string>>(new Set())
const myLabelsByKey = ref<Record<string, string[]>>({})
const labels = ref<LabelDef[]>([])
// Snoozed by me (inbox_snoozes), with the web's rule (inbox_conversations
// my_snoozed_until / my_follow_up) applied here, since this list is built on
// the device: out of sight until due, then a follow-up until opened.
const snoozes = ref<Record<string, SnoozeRow>>({})
async function loadArchivesAndLabels() {
  const [{ data: archives }, { data: assigns }, { data: labelRows }, { data: snoozeRows }] = await Promise.all([
    supabase.from('whatsapp_conversation_archives').select('conversation_key').eq('team_member_id', props.teamMemberId),
    supabase.from('whatsapp_conversation_labels').select('conversation_key, label_id').eq('team_member_id', props.teamMemberId),
    supabase.from('whatsapp_labels').select('id, name, color').order('name'),
    supabase.from('inbox_snoozes').select('conversation_key, snoozed_until, created_at').eq('team_member_id', props.teamMemberId),
  ])
  archivedKeys.value = new Set((archives ?? []).map((a) => a.conversation_key))
  snoozes.value = Object.fromEntries(((snoozeRows ?? []) as (SnoozeRow & { conversation_key: string })[]).map((r) => [r.conversation_key, r]))
  const byKey: Record<string, string[]> = {}
  for (const a of assigns ?? []) (byKey[a.conversation_key] ??= []).push(a.label_id)
  myLabelsByKey.value = byKey
  labels.value = labelRows ?? []
}
onMounted(loadArchivesAndLabels)

// Whether a lead's messages are a thread of their own, as the web Inbox draws
// them for an account with Growth, or a conversation with their number, as
// they are without it. Decided by the database's own answer
// (inbox_growth_account_ids, the SQL twin of requireGrowth), which is also
// what the web Inbox list and badge go by. The app used to file every lead's
// messages under their number regardless, so a Growth clinic saw them in two
// shapes on two devices -- read on one, unread on the other -- and a lead's
// push notification, which names lead:<id>, opened nothing.
const leadThreadsAreSeparate = ref(false)
const leadNames = ref<Record<string, string>>({})
async function loadGrowth() {
  const { data } = await supabase.rpc('inbox_growth_account_ids')
  leadThreadsAreSeparate.value = ((data ?? []) as string[]).includes(props.accountId)
}

// The poll, realtime and sending all call this; only the newest call's answer
// is kept, and a failed read keeps what is on screen. Replacing the list with
// an empty one whenever a 15-second poll lost signal emptied every
// conversation, the open thread included.
//
// The list (with its patients' names) and the leads come in one round trip;
// the open thread then takes whatever arrived in it since.
let loadRun = 0
async function load(opts: { silent?: boolean } = {}) {
  loadAssignments()
  const run = ++loadRun
  if (!opts.silent) loading.value = true
  const summaryData = await fetchSummaries()
  if (run !== loadRun) return
  applySummaries(summaryData)
  if (!opts.silent) loading.value = false
  // The receptionist's handovers and drafts for patients come with every
  // refresh, as the leads' do with the list: a handover that arrives while
  // the Inbox is open shows on its row without leaving the tab.
  loadPatientAi()
  if (selectedKey.value) await loadThreadFor(selectedKey.value)
}

interface LeadSummary { key: string; leadId: string; name: string; channel: string; unread: boolean; lastMessageAt: string; lastDirection?: string; lastMediaType?: string | null; preview: string; previewWasNotSent?: boolean; phone: string | null; patientId: string | null; aiState?: string | null; takenOverBy?: string | null; hasDraft?: boolean }
function summaryConversation(o: { key: string; patientId: string | null; phone: string | null; externalId: string | null; leadId: string | null; name: string; channel: string; direction: string; status: string; body: string | null; template: string | null; media: string | null; at: string }): Conversation {
  return {
    key: o.key,
    patientId: o.patientId,
    phoneNumber: o.phone,
    externalContactId: o.externalId,
    leadId: o.leadId,
    name: o.name,
    channel: o.channel,
    lastMessage: {
      id: `summary:${o.key}`,
      patient_id: o.patientId,
      phone_number: o.phone,
      external_contact_id: o.externalId,
      lead_id: o.leadId,
      direction: o.direction,
      status: o.status,
      body_preview: o.body,
      template_name: o.template,
      media_type: o.media,
      media_storage_path: null,
      media_mime_type: null,
      media_filename: null,
      channel: o.channel,
      created_at: o.at,
    },
    unread: false,
  }
}
const SUMMARY_COLUMNS = 'conversation_key, patient_id, phone_number, external_contact_id, first_name, last_name, last_channel, last_direction, last_status, last_body, last_template_name, last_media_type, last_at'
type SummaryRow = { conversation_key: string; patient_id: string | null; phone_number: string | null; external_contact_id: string | null; first_name: string | null; last_name: string | null; last_channel: string | null; last_direction: string | null; last_status: string | null; last_body: string | null; last_template_name: string | null; last_media_type: string | null; last_at: string }
function fromSummaryRow(row: SummaryRow): Conversation {
  const name = row.first_name ? `${row.first_name} ${row.last_name ?? ''}`.trim() : row.phone_number || (row.external_contact_id ? t('Instagram user', 'Usuario de Instagram') : t('Unknown', 'Desconocido'))
  return summaryConversation({ key: row.conversation_key, patientId: row.patient_id, phone: row.phone_number, externalId: row.external_contact_id, leadId: null, name, channel: row.last_channel ?? 'whatsapp', direction: row.last_direction ?? 'inbound', status: row.last_status ?? 'sent', body: row.last_body, template: row.last_template_name, media: row.last_media_type, at: row.last_at })
}
/** Adds conversations to the summaries, keeping one per key. */
function mergeSummaries(more: Conversation[]) {
  const have = new Set(summaries.value.map((c) => c.key))
  summaries.value = [...summaries.value, ...more.filter((c) => !have.has(c.key))]
}
// How far down inbox_conversations the list has read, for "Load more".
const summaryCount = ref(0)
const hasMoreSummaries = ref(false)
const loadingMore = ref(false)

// Every conversation, newest first, whatever the message window above holds.
async function fetchSummaries() {
  const size = Math.max(SUMMARY_LIMIT, summaryCount.value)
  const [{ data: rows }, leads] = await Promise.all([
    supabase.from('inbox_conversations').select(SUMMARY_COLUMNS).eq('account_id', props.accountId).order('last_at', { ascending: false }).range(0, size),
    leadThreadsAreSeparate.value ? authedFetch<{ conversations: LeadSummary[] }>('/api/growth/conversations').catch(() => null) : Promise.resolve(null),
  ])
  return { size, rows: (rows ?? []) as SummaryRow[], leads }
}
// Whether the AI receptionist has each conversation, as the web Inbox shows
// it: a lead's own ai_state, and for a patient what happened in the thread
// (utils/inboxAiState.ts).
type LeadAiFullState = 'none' | 'handling' | 'paused' | 'needs_human' | 'blocked'
interface LeadAi { aiState: LeadAiFullState; takenOverBy: string | null; hasDraft: boolean }
// Each lead's state as the list reports it, kept whole: the banner on an open
// thread tells "paused" from "handling", and names who took over.
const leadAi = ref<Record<string, LeadAi>>({})
const leadAiStates = computed<Record<string, InboxAiState>>(() =>
  Object.fromEntries(Object.entries(leadAi.value).flatMap(([id, l]) => (leadAiState(l.aiState) ? [[id, leadAiState(l.aiState)!]] : []))),
)
const patientAiStates = ref<Record<string, InboxAiState>>({})
// Patients with a receptionist draft waiting (inbox_reply_drafts), so the
// "Draft ready" chip and badge count them as they count leads.
const patientDrafts = ref<Set<string>>(new Set())
let patientAiToken = 0
async function loadPatientAi() {
  const ids = [...new Set(summaries.value.map((c) => c.patientId).filter((id): id is string => Boolean(id)))]
  const token = ++patientAiToken
  const details = hasReceptionist.value && ids.length ? await fetchPatientAiDetails(supabase, ids) : { states: {}, drafts: new Set<string>() }
  if (token !== patientAiToken) return
  patientAiStates.value = details.states
  patientDrafts.value = details.drafts
}
watch(
  // The entitlement is read after the first list may have arrived.
  () => [hasReceptionist.value, [...new Set(summaries.value.map((c) => c.patientId).filter(Boolean))].join(',')] as const,
  () => loadPatientAi(),
)
function aiStateOf(c: Conversation): InboxAiState | null {
  if (c.leadId) return leadAiStates.value[c.leadId] ?? null
  return c.patientId ? patientAiStates.value[c.patientId] ?? null : null
}
/** A receptionist draft is waiting on a person in this conversation. */
function hasDraftOf(c: Conversation): boolean {
  if (c.leadId) return !!leadAi.value[c.leadId]?.hasDraft
  return !!c.patientId && patientDrafts.value.has(c.patientId)
}

function applySummaries({ size, rows: page, leads }: Awaited<ReturnType<typeof fetchSummaries>>) {
  // The list carries each patient's name, so the window's messages need no
  // lookup of their own for anyone in it.
  const names = { ...patientNames.value }
  for (const row of page) if (row.patient_id && row.first_name) names[row.patient_id] = `${row.first_name} ${row.last_name ?? ''}`.trim()
  patientNames.value = names
  hasMoreSummaries.value = page.length > size
  summaryCount.value = Math.min(page.length, size)
  const list: Conversation[] = page.slice(0, size).map(fromSummaryRow)
  if (leads) leadAi.value = Object.fromEntries(leads.conversations.map((l) => [l.leadId, { aiState: (l.aiState ?? 'none') as LeadAiFullState, takenOverBy: l.takenOverBy ?? null, hasDraft: !!l.hasDraft }]))
  for (const l of leads?.conversations ?? []) {
    if (l.leadId && !leadNames.value[l.leadId]) leadNames.value = { ...leadNames.value, [l.leadId]: l.name }
    list.push(summaryConversation({ key: l.key, patientId: null, phone: l.phone, externalId: null, leadId: l.leadId, name: l.name, channel: l.channel, direction: l.lastDirection ?? (l.unread ? 'inbound' : 'outbound'), status: l.previewWasNotSent ? 'would_send' : 'sent', body: l.preview, template: null, media: l.lastMediaType ?? null, at: l.lastMessageAt }))
  }
  // Kept: what a search or "Load more" found earlier stays in the list.
  const fresh = new Set(list.map((c) => c.key))
  summaries.value = [...list, ...summaries.value.filter((c) => !fresh.has(c.key))]
}
async function loadMoreSummaries() {
  if (loadingMore.value) return
  loadingMore.value = true
  const from = summaryCount.value
  const { data } = await supabase.from('inbox_conversations').select(SUMMARY_COLUMNS).eq('account_id', props.accountId).order('last_at', { ascending: false }).range(from, from + SUMMARY_LIMIT)
  const page = (data ?? []) as SummaryRow[]
  hasMoreSummaries.value = page.length > SUMMARY_LIMIT
  summaryCount.value = from + Math.min(page.length, SUMMARY_LIMIT)
  mergeSummaries(page.slice(0, SUMMARY_LIMIT).map(fromSummaryRow))
  loadingMore.value = false
}
// A search reaches every conversation, not only the loaded ones: by name or
// number on inbox_conversations, and by anything said in a message -- as the
// web Inbox searches. What it finds joins the list.
async function searchServer(term: string) {
  const clean = term.replace(/[,()*%\\]/g, ' ').trim()
  if (clean.length < 2) return
  const [byName, wa, app] = await Promise.all([
    supabase.from('inbox_conversations').select(SUMMARY_COLUMNS).eq('account_id', props.accountId).or(`search_name.ilike.*${normalizeSearchTerm(clean)}*,phone_number.ilike.*${clean}*`).order('last_at', { ascending: false }).limit(50),
    supabase.from('whatsapp_messages').select('patient_id, phone_number, external_contact_id, lead_id').ilike('body_preview', `%${clean}%`).limit(200),
    supabase.from('patient_app_messages').select('patient_id').ilike('body', `%${clean}%`).limit(200),
  ])
  if (search.value.trim() !== term) return
  mergeSummaries(((byName.data ?? []) as SummaryRow[]).map(fromSummaryRow))
  const keys = new Set<string>()
  for (const m of (wa.data ?? []) as { patient_id: string | null; phone_number: string | null; external_contact_id: string | null; lead_id: string | null }[]) keys.add(keyOf(m))
  for (const m of (app.data ?? []) as { patient_id: string }[]) keys.add(m.patient_id)
  const missing = [...keys].filter((k) => !conversations.value.some((c) => c.key === k) && !k.startsWith('lead:'))
  if (missing.length) {
    const { data } = await supabase.from('inbox_conversations').select(SUMMARY_COLUMNS).eq('account_id', props.accountId).in('conversation_key', missing.slice(0, 100))
    mergeSummaries(((data ?? []) as SummaryRow[]).map(fromSummaryRow))
  }
  // Message text matches inside threads not loaded yet: fetched so the
  // filter below, which searches loaded messages, finds them.
  for (const k of [...keys].slice(0, 20)) if (!allMessages.value.some((m) => keyOf(m) === k)) loadThreadFor(k)
}

// A thread's own messages, newest 200, fetched when it is opened -- by the
// same identity inbox_conversations keys it by -- and after that only the
// ones newer than the newest it has.
async function loadThreadFor(key: string) {
  const c = conversations.value.find((x) => x.key === key)
  if (!c) {
    // Nothing to fetch for a conversation that does not exist yet (a patient
    // never written to) -- once the list has loaded and still lacks it.
    if (!loading.value) markThreadLoaded(key)
    return
  }
  const since = loadedThreads.value.has(key) ? newestInThread(key) : null
  const leadId = leadIdOfKey(key)
  // A lead's thread brings its draft and state with each refresh.
  if (leadId) loadLeadDraft(leadId)
  let q = supabase.from('whatsapp_messages').select(MESSAGE_COLUMNS).order('created_at', { ascending: false }).limit(200)
  if (since) q = q.gt('created_at', since)
  if (leadId) q = q.eq('lead_id', leadId).is('patient_id', null)
  else if (c.patientId) q = q.eq('patient_id', c.patientId)
  else if (c.phoneNumber) q = q.eq('phone_number', c.phoneNumber).is('patient_id', null)
  else if (c.externalContactId) q = q.eq('external_contact_id', c.externalContactId).is('patient_id', null)
  else return
  // Without the lead filter a number's thread would take a Growth lead's
  // messages too, which are their own conversation there.
  if (!leadId && !c.patientId && leadThreadsAreSeparate.value) q = q.is('lead_id', null)
  const [{ data: wa }, { data: app }] = await Promise.all([
    q,
    c.patientId
      ? (since
          ? supabase.from('patient_app_messages').select('id, patient_id, direction, body, created_at, sent_by_ai').eq('patient_id', c.patientId).gt('created_at', since).order('created_at', { ascending: false }).limit(200)
          : supabase.from('patient_app_messages').select('id, patient_id, direction, body, created_at, sent_by_ai').eq('patient_id', c.patientId).order('created_at', { ascending: false }).limit(200))
      : Promise.resolve({ data: [] as { id: string; patient_id: string; direction: string; body: string; created_at: string; sent_by_ai: boolean }[], error: null }),
  ])
  // A failed read keeps what is there, and is tried again on the next refresh.
  if (wa === null || app === null) return
  const fetched: Message[] = [
    ...((wa ?? []) as Message[]),
    ...((app ?? []) as { id: string; patient_id: string; direction: string; body: string; created_at: string; sent_by_ai: boolean }[]).map((m) => ({
      id: m.id, sent_by_ai: m.sent_by_ai, patient_id: m.patient_id, phone_number: null, external_contact_id: null, lead_id: null, direction: m.direction, status: 'sent', body_preview: m.body,
      template_name: null, media_type: null, media_storage_path: null, media_mime_type: null, media_filename: null, channel: 'in_app', created_at: m.created_at,
    })),
  ]
  const known = new Set(threadExtra.value.map((m) => m.id))
  const fresh = fetched.filter((m) => !known.has(m.id))
  if (fresh.length) threadExtra.value = [...threadExtra.value, ...fresh]
  markThreadLoaded(key)
}
function markThreadLoaded(key: string) {
  if (loadedThreads.value.has(key)) return
  loadedThreads.value = new Set(loadedThreads.value).add(key)
}
onMounted(async () => {
  await loadGrowth()
  await load()
})

const allMessages = computed(() =>
  mergePendingIntoThread(threadExtra.value, pendingMessages.value, keptKeys.value).sort((a, b) => b.created_at.localeCompare(a.created_at)),
)

// The conversation a message belongs to, keyed exactly as the web Inbox and
// inbox_conversations key it (a Growth account's lead, else patient, else
// phone, else Instagram id) -- the read, archive and label rows are shared
// with the web by this key, so it has to be the same one. Instagram has no
// phone, so keying on the phone alone put every DM from every Instagram
// account into a single "Unknown" thread, whose replies then had nobody to
// go to.
function keyOf(m: Pick<Message, 'patient_id' | 'phone_number' | 'external_contact_id' | 'lead_id'>) {
  return inboxConversationKey(m, leadThreadsAreSeparate.value)
}
/** The newest message a conversation already had, so a pending bubble is only matched to a row newer than it. */
function newestInThread(key: string): string | null {
  let newest: string | null = null
  for (const m of threadExtra.value) if (keyOf(m) === key && (!newest || m.created_at > newest)) newest = m.created_at
  return newest
}

const conversations = computed<Conversation[]>(() => {
  const byKey = new Map<string, Message[]>()
  for (const m of allMessages.value) {
    const key = keyOf(m)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(m)
  }
  const list: Conversation[] = []
  const summaryByKey = new Map(summaries.value.map((c) => [c.key, c]))
  const drawn = new Set<string>()
  for (const [key, msgs] of byKey) {
    const last = msgs[0]
    // A thread loaded earlier and not open since has not been brought up to
    // date; the list has, so when it knows of something newer it is drawn
    // from the list instead.
    const sum = summaryByKey.get(key)
    if (sum && sum.lastMessage.created_at > last.created_at) continue
    drawn.add(key)
    list.push({
      key,
      patientId: last.patient_id,
      phoneNumber: last.phone_number ?? msgs.find((m) => m.phone_number)?.phone_number ?? null,
      // The IGSID, which is who an Instagram reply is addressed to. It was
      // read when sending but never selected, so every Instagram thread
      // carried undefined and the reply could not be addressed at all. From
      // any message in the thread, not only the newest: that may be an
      // in-app message or this device's own pending bubble.
      externalContactId: msgs.find((m) => m.external_contact_id)?.external_contact_id ?? null,
      leadId: leadIdOfKey(key),
      name:
        (last.patient_id && patientNames.value[last.patient_id]) ||
        (leadIdOfKey(key) && leadNames.value[leadIdOfKey(key)!]) ||
        sum?.name ||
        msgs.find((m) => m.phone_number)?.phone_number ||
        (last.external_contact_id ? t('Instagram user', 'Usuario de Instagram') : t('Unknown', 'Desconocido')),
      channel: last.channel,
      lastMessage: last,
      unread: markedUnread(key) || (last.direction === 'inbound' && (!readTimestamps.value[key] || readTimestamps.value[key] < last.created_at)),
    })
  }
  // Every other conversation, from the list.
  for (const sum of summaries.value) {
    if (drawn.has(sum.key)) continue
    const at = sum.lastMessage.created_at
    list.push({ ...sum, unread: markedUnread(sum.key) || (sum.lastMessage.direction === 'inbound' && (!readTimestamps.value[sum.key] || readTimestamps.value[sum.key] < at)) })
    drawn.add(sum.key)
  }
  // Snoozes: what they last wrote is what brings one back early (the view
  // reads its last inbound message; the newest one, when it is theirs, is
  // the closest thing this list has).
  const sortAt = new Map<string, number>()
  for (const c of list) {
    const last = c.lastMessage
    const state = snoozeStateOf(snoozes.value[c.key], last.direction === 'inbound' ? last.created_at : null, readTimestamps.value[c.key])
    c.snoozedUntil = state === 'hidden' ? snoozes.value[c.key]!.snoozed_until : null
    c.followUp = state === 'follow_up'
    if (c.followUp) c.unread = true
    // A follow-up sits at the time it came due, as on the web.
    sortAt.set(c.key, c.followUp ? Math.max(Date.parse(last.created_at), Date.parse(snoozes.value[c.key]!.snoozed_until)) : Date.parse(last.created_at))
  }
  return list.sort((a, b) => sortAt.get(b.key)! - sortAt.get(a.key)!)
})

// "Caduca en 3 h", as on the web: the patient wrote last, the 24h window
// shuts soon, and what they wrote wants an answer (utils/inboxReplyWindow.ts).
// `now` ticks each minute so the pill appears, and counts down, on its own.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => (nowTimer = setInterval(() => (now.value = Date.now()), 60000)))
onUnmounted(() => clearInterval(nowTimer))
function windowPill(c: Conversation) {
  const m = c.lastMessage
  return replyWindowPill({ direction: m.direction, channel: m.channel, at: m.created_at, body: m.body_preview, mediaType: m.media_type }, now.value)
}

// Search matches name, phone number, and anything said in the conversation
// -- not just the last message -- so finding "that time they mentioned X"
// works the same as finding a patient by name or number.
const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (term) => {
  clearTimeout(searchTimer)
  const q = term.trim()
  searchTimer = setTimeout(() => {
    if (search.value.trim() === q && q) searchServer(q)
  }, 350)
})
const conversationSearchText = computed(() => {
  const map: Record<string, string> = {}
  for (const m of allMessages.value) {
    const key = keyOf(m)
    map[key] = `${map[key] ?? ''} ${m.body_preview ?? ''}`
  }
  return map
})
// Who each conversation is assigned to (inbox_assignments, the web Inbox's
// "Mine / Unassigned"), and the team's names to show and pick from.
const assignments = ref<Record<string, string>>({})
const teamNames = ref<{ id: string; full_name: string }[]>([])
async function loadAssignments() {
  const [{ data: a }, { data: tm }] = await Promise.all([
    supabase.from('inbox_assignments').select('conversation_key, team_member_id').eq('account_id', props.accountId),
    teamNames.value.length ? Promise.resolve({ data: null }) : supabase.from('team_members').select('id, full_name').is('deleted_at', null).order('full_name'),
  ])
  if (a) assignments.value = Object.fromEntries((a as { conversation_key: string; team_member_id: string }[]).map((r) => [r.conversation_key, r.team_member_id]))
  if (tm) teamNames.value = tm as { id: string; full_name: string }[]
}
const assigneeName = (key: string) => teamNames.value.find((m) => m.id === assignments.value[key])?.full_name ?? null
const assignFilter = ref<'all' | 'mine' | 'unassigned'>('all')

const view = ref<'active' | 'archived' | 'snoozed'>('active')
const unreadOnly = ref(false)
// "Por caducar", as on the web: only what carries the "Caduca en" pill.
const expiringOnly = ref(false)
const replyFilter = ref<'all' | 'awaiting_us' | 'awaiting_patient'>('all')
const labelFilter = ref<string | null>(null)
// Patients' conversations or leads' own threads (Growth): the web Inbox's
// Patients / Leads chips.
const sourceFilter = ref<'all' | 'patients' | 'leads'>('all')

// The filters: three views on top (segment, below) and the rest in a sheet,
// with whatever is narrowing the list still in sight as removable chips
// under the views (activeFilterChips).
const activeList = computed(() => conversations.value.filter((c) => !archivedKeys.value.has(c.key) && !c.snoozedUntil))
const unreadCount = computed(() => activeList.value.filter((c) => c.unread).length)
const expiringCount = computed(() => activeList.value.filter((c) => windowPill(c)).length)
// The receptionist's two queues, as chips on the web Inbox: threads where a
// reply is written and waiting on a decision (the work drafting was meant to
// remove is opening threads one at a time to find them), and threads it
// handed to a person. Each is shown only while there is one.
const draftReadyOnly = ref(false)
const needsHumanOnly = ref(false)
const draftReadyCount = computed(() => activeList.value.filter(hasDraftOf).length)
const needsHumanCount = computed(() => activeList.value.filter((c) => aiStateOf(c) === 'needs_human').length)
// The receptionist's work as one view (IA): a draft waiting on someone, or a
// thread it handed to a person.
const aiOnly = ref(false)
const aiCount = computed(() => activeList.value.filter((c) => hasDraftOf(c) || aiStateOf(c) === 'needs_human').length)
const awaitingCount = computed(() => activeList.value.filter((c) => c.lastMessage.direction === 'inbound').length)
const filtersActive = computed(() => view.value !== 'active' || unreadOnly.value || expiringOnly.value || assignFilter.value !== 'all' || replyFilter.value !== 'all' || !!labelFilter.value || sourceFilter.value !== 'all' || draftReadyOnly.value || needsHumanOnly.value || aiOnly.value)

// Three views on top -- everything, what waits on us, the receptionist's --
// and the rest of the filters in a sheet behind one button. Twelve chips in
// a sideways-scrolling row were more than anyone could see at once, and the
// ones that mattered were off the edge of the screen.
type InboxSegment = 'all' | 'awaiting' | 'ai'
const segment = computed<InboxSegment>(() => (aiOnly.value ? 'ai' : replyFilter.value === 'awaiting_us' ? 'awaiting' : 'all'))
function setSegment(s: InboxSegment) {
  aiOnly.value = s === 'ai'
  replyFilter.value = s === 'awaiting' ? 'awaiting_us' : 'all'
}
const filtersOpen = ref(false)
// What the sheet narrows, each removable on its own from the strip under the
// views; the badge on the Filters button counts them.
const activeFilterChips = computed(() => {
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (assignFilter.value === 'mine') chips.push({ key: 'mine', label: t('Mine', 'Mías'), clear: () => (assignFilter.value = 'all') })
  if (assignFilter.value === 'unassigned') chips.push({ key: 'unassigned', label: t('Unassigned', 'Sin asignar'), clear: () => (assignFilter.value = 'all') })
  if (sourceFilter.value === 'patients') chips.push({ key: 'patients', label: t('Patients', 'Pacientes'), clear: () => (sourceFilter.value = 'all') })
  if (sourceFilter.value === 'leads') chips.push({ key: 'leads', label: t('Leads', 'Leads'), clear: () => (sourceFilter.value = 'all') })
  if (unreadOnly.value) chips.push({ key: 'unread', label: t('Unread', 'No leídas'), clear: () => (unreadOnly.value = false) })
  if (expiringOnly.value) chips.push({ key: 'expiring', label: t('Expiring', 'Por caducar'), clear: () => (expiringOnly.value = false) })
  if (draftReadyOnly.value) chips.push({ key: 'draft', label: t('Draft ready', 'Borrador listo'), clear: () => (draftReadyOnly.value = false) })
  if (needsHumanOnly.value) chips.push({ key: 'human', label: t('Needs human', 'Requiere persona'), clear: () => (needsHumanOnly.value = false) })
  if (labelFilter.value) {
    const l = labels.value.find((x) => x.id === labelFilter.value)
    chips.push({ key: 'label', label: l?.name ?? t('Label', 'Etiqueta'), clear: () => (labelFilter.value = null) })
  }
  if (view.value === 'snoozed') chips.push({ key: 'snoozed', label: t('Snoozed', 'Pospuestas'), clear: () => (view.value = 'active') })
  if (view.value === 'archived') chips.push({ key: 'archived', label: t('Archived', 'Archivadas'), clear: () => (view.value = 'active') })
  return chips
})
function clearFilters() {
  aiOnly.value = false
  view.value = 'active'
  unreadOnly.value = false
  expiringOnly.value = false
  assignFilter.value = 'all'
  replyFilter.value = 'all'
  labelFilter.value = null
  sourceFilter.value = 'all'
  draftReadyOnly.value = false
  needsHumanOnly.value = false
}
const chipBase = 'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium'
const chipClass = (on: boolean) => `${chipBase} ${on ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'}`

// "AG" for Ana García; a number or an Instagram account has no initials,
// and showing "+3" for every phone said nothing, so those get an icon.
function initialsOf(name: string) {
  const letters = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase())
  return letters.join('')
}
const memberInitials = (id: string | undefined) => {
  const name = teamNames.value.find((m) => m.id === id)?.full_name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
}

const filteredConversations = computed(() => {
  let list = conversations.value.filter((c) => archivedKeys.value.has(c.key) === (view.value === 'archived') && (view.value === 'archived' || !!c.snoozedUntil === (view.value === 'snoozed')))
  if (view.value === 'snoozed') list = [...list].sort((a, b) => Date.parse(a.snoozedUntil!) - Date.parse(b.snoozedUntil!))
  if (search.value.trim()) {
    const q = normalizeSearchTerm(search.value.trim())
    list = list.filter((c) => normalizeSearchTerm(`${c.name} ${c.phoneNumber ?? ''} ${conversationSearchText.value[c.key] ?? ''}`).includes(q))
  }
  if (assignFilter.value === 'mine') list = list.filter((c) => assignments.value[c.key] === props.teamMemberId)
  else if (assignFilter.value === 'unassigned') list = list.filter((c) => !assignments.value[c.key])
  if (unreadOnly.value) list = list.filter((c) => c.unread)
  // The least time left first.
  if (expiringOnly.value) list = list.filter((c) => windowPill(c)).sort((a, b) => Date.parse(a.lastMessage.created_at) - Date.parse(b.lastMessage.created_at))
  if (replyFilter.value === 'awaiting_us') list = list.filter((c) => c.lastMessage.direction === 'inbound')
  else if (replyFilter.value === 'awaiting_patient') list = list.filter((c) => c.lastMessage.direction === 'outbound')
  if (labelFilter.value) list = list.filter((c) => myLabelsByKey.value[c.key]?.includes(labelFilter.value!))
  if (sourceFilter.value === 'leads') list = list.filter((c) => !!c.leadId)
  else if (sourceFilter.value === 'patients') list = list.filter((c) => !c.leadId)
  if (draftReadyOnly.value) list = list.filter(hasDraftOf)
  if (needsHumanOnly.value) list = list.filter((c) => aiStateOf(c) === 'needs_human')
  if (aiOnly.value) list = list.filter((c) => hasDraftOf(c) || aiStateOf(c) === 'needs_human')
  return list
})

// One line under the preview saying the one thing about a conversation that
// matters most, instead of a row of up to six pills: whether someone has to
// act for the receptionist first, then a follow-up, then how long WhatsApp
// leaves to answer, then when a snoozed one comes back. The window's time is
// added to an AI line when both apply, since it is what makes either urgent.
function rowStatus(c: Conversation): { key: string; tone: 'brand' | 'warning' | 'danger' | 'muted'; text: string; icon: 'ai' | 'dot' | 'clock' } | null {
  const win = windowPill(c)
  if (aiStateOf(c) === 'needs_human') return { key: 'needs-human', tone: 'warning', icon: 'dot', text: t('The AI handed this to a person', 'La IA lo ha pasado a una persona') }
  if (hasDraftOf(c)) return { key: 'draft-ready', tone: 'brand', icon: 'ai', text: t('AI draft ready', 'Borrador de la IA listo') }
  if (aiStateOf(c) === 'handling') return { key: 'ai-handling', tone: 'muted', icon: 'ai', text: t('The AI is on it', 'La IA lo lleva') }
  if (c.followUp) return { key: 'follow-up', tone: 'warning', icon: 'dot', text: t('Follow up', 'Seguimiento') }
  if (win) return { key: 'window', tone: win.urgent ? 'danger' : 'warning', icon: 'clock', text: t(`WhatsApp closes in ${win.left}`, `WhatsApp cierra en ${win.left}`) }
  if (c.snoozedUntil) return { key: 'snoozed', tone: 'muted', icon: 'clock', text: `${t('Back', 'Vuelve')} ${snoozeWhen(c.snoozedUntil)}` }
  return null
}
const STATUS_TONE: Record<'brand' | 'warning' | 'danger' | 'muted', string> = { brand: 'text-brand-text', warning: 'text-warning-text', danger: 'text-danger-text', muted: 'text-ink-muted2' }

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
// Opening a thread fetches its own messages (loadThreadFor), so one the
// newest-500 window never reached still shows its history.
watch(selectedKey, (key) => {
  if (key) loadThreadFor(key)
})
// A patient opened from their record (WhatsApp on the patient screen) who has
// never exchanged a message has no conversation to find, and the thread view
// rendered nothing at all. This stands in for it until a message exists: the
// patient's name and an empty thread, under the same 24-hour rule as any
// other -- with no inbound message there is no window, so the composer
// explains that rather than offering a send WhatsApp would refuse.
const draftConversation = ref<Conversation | null>(null)
const selected = computed(
  () => conversations.value.find((c) => c.key === selectedKey.value) ??
    // Not while the messages are still loading: a real thread would flash up as an empty one first.
    (!loading.value && draftConversation.value?.key === selectedKey.value ? draftConversation.value : null),
)
async function prepareDraftConversation(patientId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) return
  const { data } = await supabase.from('patients').select('id, first_name, last_name').eq('id', patientId).maybeSingle()
  if (!data) return
  const now = new Date().toISOString()
  draftConversation.value = {
    key: patientId,
    patientId,
    phoneNumber: null,
    externalContactId: null,
    leadId: null,
    name: `${data.first_name} ${data.last_name ?? ''}`.trim(),
    channel: 'whatsapp',
    // Never listed, so never read as a preview; present only because a
    // conversation always has one.
    lastMessage: {
      id: `draft-${patientId}`,
      patient_id: patientId,
      phone_number: null,
      external_contact_id: null,
      lead_id: null,
      direction: 'outbound',
      status: 'sent',
      body_preview: null,
      template_name: null,
      media_type: null,
      media_storage_path: null,
      media_mime_type: null,
      media_filename: null,
      channel: 'whatsapp',
      created_at: now,
    },
    unread: false,
  }
}
const thread = computed(() =>
  selectedKey.value ? allMessages.value.filter((m) => keyOf(m) === selectedKey.value).slice().reverse() : [],
)
// Whether the open thread's messages have arrived. The composer's 24-hour
// rule and "they have not written yet" are read from them, so they wait.
const threadReady = computed(() => !selectedKey.value || loadedThreads.value.has(selectedKey.value) || thread.value.length > 0)
// Follows the bottom of the thread automatically -- a reply the practitioner
// just sent, or a message that just arrived, used to sit hidden behind the
// composer bar until they scrolled by hand.
watch(thread, () => scrollThreadToBottom())
watch(selectedKey, (key) => {
  if (key) scrollThreadToBottom()
})

// The patient's next visit, in the thread header (useNextVisit).
const { next: nextVisit, loaded: nextVisitLoaded } = useNextVisit(() => selected.value?.patientId)
const nextVisitWhen = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: staffContext.value?.timeZone ?? undefined })

// Internal notes (inbox_notes), as in the web Inbox: the team's, in the
// thread between the messages, never sent; a mention reaches the colleague
// as an unread conversation and a push. On a lead's thread too, keyed
// lead:<id>; converting the lead moves them to the patient's thread with the
// messages (20261012055054). Not on a conversation with no messages yet.
const { notes: threadNotes, saving: noteSaving, error: noteError, add: addNote, remove: removeNote } = useInboxNotes({
  accountId: () => props.accountId,
  conversationKey: () => (selected.value && thread.value.length > 0 ? selected.value.key : null),
  authorId: () => props.teamMemberId,
  notifyMentions: (noteId) => authedFetch('/api/inbox/note-mentions', { method: 'POST', body: { noteId } }),
})
const noteMode = ref(false)
watch(selectedKey, () => (noteMode.value = false))
async function saveNote(body: string, mentions: string[]) {
  if (await addNote(body, mentions)) {
    noteMode.value = false
    scrollThreadToBottom()
  }
}
const notesBefore = (i: number) => notesBetween(threadNotes.value, i === 0 ? null : thread.value[i - 1]!.created_at, thread.value[i]!.created_at)
const notesAfterLast = computed(() => notesBetween(threadNotes.value, thread.value.length ? thread.value[thread.value.length - 1]!.created_at : null, null))

// -- The AI receptionist on the open thread ----------------------------------
// Who is answering, in the banner under the header (InboxAiBanner, shared
// with the web): a lead's own ai_state, and for a patient what happened in
// the thread (patientAiStates). The buttons do what the web Inbox's do
// (pages/inbox.vue, components/growth/InboxLeadThread.vue), through the same
// routes, so a thread taken over on a phone reads as taken over at the desk.
const selectedLeadId = computed(() => selected.value?.leadId ?? null)
const selectedLeadAi = computed(() => (selectedLeadId.value ? leadAi.value[selectedLeadId.value] ?? null : null))
// The receptionist is answering this lead itself: the composer stays locked
// until a person takes over -- two of them typing into the same conversation
// is the failure the banner exists to prevent.
const leadComposerLocked = computed(() => selectedLeadAi.value?.aiState === 'handling')
const leadChannelBlocked = computed(() => selectedLeadAi.value?.aiState === 'blocked')
// Why the receptionist handed this over, from the note it left in the thread.
const handoverReason = computed(() => latestHandoverReason(threadNotes.value))
// The receptionist is off or at its monthly limit: said in the thread,
// because the only other sign is drafts quietly not arriving.
const { quiet: receptionistQuiet } = useReceptionistQuiet(hasReceptionist, () => props.accountId)

// The open lead's own row: the draft the receptionist left (ai_draft_body,
// which the list only flags) and its state, read with the member's own
// client as the web reads the thread (utils/leadThread.ts). The list route's
// Growth check is what let the lead be opened at all.
const leadDraft = ref<{ leadId: string; body: string; at: string | null } | null>(null)
watch(selectedKey, () => {
  leadDraft.value = null
  // Another conversation: the last one's failed send is not this one's.
  sendError.value = ''
})
async function loadLeadDraft(leadId: string) {
  const { data } = await supabase
    .from('leads')
    .select('ai_state, ai_draft_body, ai_draft_created_at, team_members:ai_taken_over_by(full_name)')
    .eq('id', leadId)
    .maybeSingle()
  if (!data) return
  const row = data as { ai_state: string | null; ai_draft_body: string | null; ai_draft_created_at: string | null; team_members: { full_name: string } | null }
  leadAi.value = { ...leadAi.value, [leadId]: { aiState: (row.ai_state ?? 'none') as LeadAiFullState, takenOverBy: row.team_members?.full_name ?? null, hasDraft: !!row.ai_draft_body } }
  if (selectedLeadId.value !== leadId) return
  leadDraft.value = row.ai_draft_body ? { leadId, body: row.ai_draft_body, at: row.ai_draft_created_at } : null
}

// Hands a lead between the AI and a person. Shown at once; the route's
// answer (which records WHO took over) confirms it.
async function setLeadAiState(leadId: string, state: LeadAiFullState) {
  const before = leadAi.value[leadId]
  leadAi.value = { ...leadAi.value, [leadId]: { aiState: state, takenOverBy: before?.takenOverBy ?? null, hasDraft: before?.hasDraft ?? false } }
  try {
    const result = await authedFetch<{ aiState: LeadAiFullState; takenOverBy: string | null }>(`/api/growth/leads/${leadId}/ai-state`, { method: 'POST', body: { state } })
    leadAi.value = { ...leadAi.value, [leadId]: { ...leadAi.value[leadId]!, aiState: result.aiState, takenOverBy: result.takenOverBy } }
  } catch {
    if (before) leadAi.value = { ...leadAi.value, [leadId]: before }
    showNotice(t('Could not change who is answering.', 'No se ha podido cambiar quién responde.'))
  }
}
const onLeadTakeOver = () => selectedLeadId.value && setLeadAiState(selectedLeadId.value, 'paused')
const onLeadHandBack = () => selectedLeadId.value && setLeadAiState(selectedLeadId.value, 'handling')
// A handover a person has dealt with: nobody's now, neither the AI's nor
// flagged. Without it a lead handed over stayed "Needs human" for ever.
const onLeadMarkHandled = () => selectedLeadId.value && setLeadAiState(selectedLeadId.value, 'none')
// A patient's handover lives on inbox_reply_drafts.handed_over_at
// (patientReplyDraft.ts): cleared, the receptionist may answer them again
// and the row stops saying "Needs human".
async function onPatientMarkHandled() {
  const patientId = selected.value?.patientId
  if (!patientId) return
  const { error } = await supabase.from('inbox_reply_drafts').update({ handed_over_at: null }).eq('conversation_key', patientId)
  if (error) {
    showNotice(t('Could not mark it as handled.', 'No se ha podido marcar como atendida.'))
    return
  }
  await loadPatientAi()
}

// A lead's draft, in the same card a patient's waits in (InboxAiDraftCard).
// Approving sends it the way a typed reply goes and then clears it -- after
// the send, never inside the send route, so a draft cannot survive its own
// send and go twice (useGrowthLeadThread.approveDraft).
async function discardLeadDraft() {
  const leadId = selectedLeadId.value
  if (!leadId) return
  try {
    await authedFetch(`/api/growth/leads/${leadId}/draft-reply`, { method: 'DELETE' })
    if (leadDraft.value?.leadId === leadId) leadDraft.value = null
    if (leadAi.value[leadId]) leadAi.value = { ...leadAi.value, [leadId]: { ...leadAi.value[leadId]!, hasDraft: false } }
  } catch {
    showNotice(t('Could not discard that draft.', 'No se ha podido descartar el borrador.'))
  }
}
async function approveLeadDraft(text: string) {
  if (!selectedLeadId.value) return
  if (await sendTextMessage(text)) await discardLeadDraft()
}

// A reply the receptionist wrote for a patient without being asked
// (receptionist-draft-cron, inbox_reply_drafts), keyed by the conversation --
// the patient's id -- shown by InboxReplyDraft as soon as the thread opens,
// and marked dealt with once sent or thrown away. The web's storedReplyDraft.
function storedReplyDraft(patientId: string) {
  return {
    load: async () => {
      const { data } = await supabase.from('inbox_reply_drafts').select('body').eq('conversation_key', patientId).is('dismissed_at', null).maybeSingle()
      return data?.body ?? null
    },
    dismiss: async () => {
      await supabase.from('inbox_reply_drafts').update({ dismissed_at: new Date().toISOString() }).eq('conversation_key', patientId).is('dismissed_at', null)
      await loadPatientAi()
    },
  }
}

// Opens straight to the conversation a push notification tap wants -- fires
// on mount (app was closed/backgrounded, tap launched/foregrounded it) and
// again on change (tap arrives while already sitting on this tab, where
// there's no navigation to remount from). Cleared right after consuming it
// so it doesn't re-open on the next unrelated visit to this tab.
watch(
  () => props.openConversationKey,
  async (key) => {
    if (!key) return
    pendingConversationKey.value = null
    // A lead's notification names lead:<id>. That is the thread itself for a
    // Growth account; without Growth the lead's messages are a conversation
    // with their number, and once the lead is converted they are the
    // patient's (20261012055054) -- so the key is read off their newest
    // message, which knows all three. A lead nobody has written to yet has
    // none, and is its own thread. Which applies needs the first load.
    const leadId = leadIdOfKey(key)
    if (leadId) {
      await whenLoaded()
      const resolved = (await conversationKeyForLead(leadId)) ?? (leadThreadsAreSeparate.value ? key : null)
      if (!resolved) return
      selectedKey.value = resolved
      markRead(resolved)
      return
    }
    selectedKey.value = key
    markRead(key)
    prepareDraftConversation(key)
  },
  { immediate: true },
)

function whenLoaded(): Promise<void> {
  if (!loading.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(loading, (l) => {
      if (l) return
      stop()
      resolve()
    })
  })
}

async function conversationKeyForLead(leadId: string): Promise<string | null> {
  const loaded = threadExtra.value.find((m) => m.lead_id === leadId)
  if (loaded) return keyOf(loaded)
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('patient_id, phone_number, external_contact_id, lead_id')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? keyOf(data) : null
}

// Assigning, as the web Inbox does: one row per conversation, removed for
// "nobody". Shown at once; the next load confirms it.
const assignOpen = ref(false)
async function assign(key: string, memberId: string | null) {
  assignOpen.value = false
  const before = assignments.value[key]
  const next = { ...assignments.value }
  if (memberId) next[key] = memberId
  else delete next[key]
  assignments.value = next
  const { error } = memberId
    ? await supabase.from('inbox_assignments').upsert({ account_id: props.accountId, conversation_key: key, team_member_id: memberId, assigned_by: props.teamMemberId, assigned_at: new Date().toISOString() } as never)
    : await supabase.from('inbox_assignments').delete().eq('account_id', props.accountId).eq('conversation_key', key)
  if (error) {
    const back = { ...assignments.value }
    if (before) back[key] = before
    else delete back[key]
    assignments.value = back
  }
}

// A WhatsApp thread from a number with no patient (and not a Growth lead's
// own thread): attach it to one (InboxLinkSheet, the web's UnknownPanel).
const linkOpen = ref(false)
const canLinkSelected = computed(() => {
  const c = selected.value
  return !!c && !c.patientId && !c.leadId && !!c.phoneNumber && c.channel === 'whatsapp' && can('patients_edit')
})
async function onLinked(patientId: string) {
  linkOpen.value = false
  await load({ silent: true })
  selectedKey.value = patientId
}

// The tab's badge counts the same reads and archives: told after each change.
const { refresh: refreshBadge } = useInboxUnread()
async function markRead(key: string) {
  const now = new Date().toISOString()
  readTimestamps.value = { ...readTimestamps.value, [key]: now }
  await supabase.from('inbox_reads').upsert({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: key, last_read_at: now } as never)
  refreshBadge()
}
function openConversation(c: Conversation) {
  selectedKey.value = c.key
  if (c.unread) markRead(c.key)
}

// Conversations are archived, never deleted: messages are part of the
// patient's record. (Same as the web Inbox.)
async function bulkMarkUnreadSelected() {
  const past = new Date(0).toISOString()
  for (const key of selectedKeys.value) {
    readTimestamps.value = { ...readTimestamps.value, [key]: past }
    await supabase.from('inbox_reads').upsert({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: key, last_read_at: past } as never)
  }
  exitSelectionMode()
  refreshBadge()
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
  refreshBadge()
}

// A line at the bottom for a moment: what a snooze did, or what quietly
// failed (the app has no toast of its own).
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function showNotice(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3500)
}

// Single-conversation archive toggle, used from the row swipe action.
// Snooze (just for me): out of my list until then, back as a follow-up --
// the same row the web Inbox writes. Snoozing closes the thread, which has
// just left the list it was opened from.
async function snoozeKey(key: string, at: string | null) {
  const created = new Date().toISOString()
  const { error } = at
    ? await supabase.from('inbox_snoozes').upsert({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: key, snoozed_until: at, created_at: created } as never)
    : await supabase.from('inbox_snoozes').delete().eq('team_member_id', props.teamMemberId).eq('conversation_key', key)
  if (error) {
    showNotice(t("Couldn't snooze it. Try again.", 'No se ha podido posponer. Inténtalo de nuevo.'))
  } else {
    const next = { ...snoozes.value }
    if (at) next[key] = { snoozed_until: at, created_at: created }
    else delete next[key]
    snoozes.value = next
    if (at && selectedKey.value === key) selectedKey.value = null
    showNotice(at
      ? t(`Snoozed until ${new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`, `Pospuesta hasta el ${new Date(at).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`)
      : t('Back in your Inbox.', 'De vuelta en tu bandeja.'))
  }
  refreshBadge()
}
const snoozeWhen = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

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
  refreshBadge()
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
  await supabase.from('inbox_reads').upsert({ account_id: props.accountId, team_member_id: props.teamMemberId, conversation_key: c.key, last_read_at: past } as never)
  refreshBadge()
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
const ROW_ACTIONS_WIDTH = 152 // Unread + Archive, 76px each
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
  // The website chat has no window: a visitor reads the answer whenever
  // they next open the chat.
  if (replyChannel.value === 'in_app' || replyChannel.value === 'webchat') return true
  // Whichever channel the reply goes out on -- not always WhatsApp. An
  // Instagram thread's inbound messages carry channel 'instagram', so looking
  // only at WhatsApp ones found nothing and every Instagram conversation read
  // as "more than 24 hours since they last wrote", however recent it was. The
  // composer was shut before the first DM had finished arriving.
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound' && m.channel === replyChannel.value).at(-1)
  if (!lastInbound) return false
  return Date.now() - new Date(lastInbound.created_at).getTime() < 24 * 60 * 60 * 1000
})

// -- Send a template -----------------------------------------------------------
// Outside the 24-hour window (or before the first message) a template is the
// only thing WhatsApp accepts. The same two routes as the web Inbox's "Send
// template": listing them needs communication_config, sending one recalls_access
// for a patient or inbox_access for a bare number -- so the option is offered
// only when both would succeed. A minor or a do-not-contact patient is never
// offered it (the send route refuses them too).
// From a patient's thread: their record, and booking them (the record's own
// sheet, via ?book=1), as the record's Book button allows it.
// The deployed site, where the clinic's booking page lives (the app itself is
// served from capacitor://, which no patient can open).
const apiBase = useRuntimeConfig().public.apiBase as string
const canBookFromThread = computed(() => !!staffContext.value && !restricted('calendar_read_only') && (staffContext.value.isOwner || staffContext.value.permissions.calendar_scope !== 'none'))
const templateSheetOpen = ref(false)
const contactBlocked = ref(false)
watch(
  () => selected.value?.patientId ?? null,
  async (patientId) => {
    contactBlocked.value = false
    if (!patientId) return
    const { data } = await supabase.from('patients').select('is_minor, do_not_contact').eq('id', patientId).maybeSingle()
    if (selected.value?.patientId === patientId) contactBlocked.value = !!(data?.is_minor || data?.do_not_contact)
  },
  { immediate: true },
)
// A Growth lead's own thread sends with leadId, as the web's lead thread
// does: to their number, filed in their thread (whatsapp/send). A lead from
// an ad form has often never written, so this is the only way to reach them
// at all -- the app used to offer nothing there.
const templateTarget = computed(() => {
  const c = selected.value
  if (!c || replyChannel.value !== 'whatsapp') return false
  return !!(c.patientId || c.leadId || c.phoneNumber)
})
const templateAllowed = computed(() => {
  const c = selected.value
  if (!c) return false
  // The route's own rule: a lead needs communication_config alone.
  if (c.leadId && !c.patientId) return can('communication_config')
  return can('communication_config') && can(c.patientId ? 'recalls_access' : 'inbox_access')
})
// Whether they have ever written on this channel: "more than 24 hours since
// they last wrote" is only true of someone who did. A lead reached first by
// our own messages has not, and was told the opposite.
const everWrote = computed(() => thread.value.some((m) => m.direction === 'inbound' && m.channel === replyChannel.value))
const canSendTemplate = computed(() => templateTarget.value && templateAllowed.value && !contactBlocked.value)
async function onTemplateSent() {
  templateSheetOpen.value = false
  sendError.value = ''
  await load({ silent: true })
}

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')
const composerTextarea = ref<HTMLTextAreaElement>()
const fileInput = ref<HTMLInputElement>()
const cameraInput = ref<HTMLInputElement>()

// One-tap Send on the receptionist's suggested reply (InboxReplyDraft): the
// way a typed reply goes.
function sendDraft(text: string) {
  sendTextMessage(text)
}

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
    } else if (channel === 'instagram') {
      // Its own route: a recipient here is an IGSID, not a phone number, so
      // whatsapp/inbox-send has nothing to send to. Everything that was not
      // in-app used to go there, which meant /api/instagram/send existed and
      // shipped and was never once called -- an Instagram reply was posted to
      // WhatsApp with no number and failed.
      if (!target.externalContactId) throw new Error('This Instagram conversation has no sender id')
      await authedFetch('/api/instagram/send', { method: 'POST', body: { recipientId: target.externalContactId, text } })
    } else if (channel === 'messenger' || channel === 'webchat') {
      // No phone either: addressed by lead, or by the id they wrote from.
      if (!target.leadId && !target.externalContactId) throw new Error('This conversation has no sender id')
      await authedFetch(channel === 'messenger' ? '/api/messenger/send' : '/api/webchat/send', {
        method: 'POST',
        body: { leadId: target.leadId ?? undefined, recipientId: target.leadId ? undefined : target.externalContactId, text },
      })
    } else {
      // A lead's own thread is addressed by lead, as the web does
      // (useGrowthLeadThread.reply): the route finds the number and files
      // the message in the thread. By phone alone it depended on a message
      // in the thread carrying one.
      await authedFetch('/api/whatsapp/inbox-send', {
        method: 'POST',
        body: {
          patientId: target.patientId ?? undefined,
          leadId: target.patientId ? undefined : target.leadId ?? undefined,
          phoneNumber: target.patientId || target.leadId ? undefined : target.phoneNumber,
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
    // Quietly: a loud reload sets `loading`, which drops a thread that is
    // only a draft so far and skeletons the list behind it -- the sent
    // message blinked, and the list showed placeholders over real rows.
    await load({ silent: true })
    settlePending(tempId, threadExtra.value)
    delete retryPayloads.value[tempId]
    return true
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? t('Failed to send', 'Error al enviar')
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, pending: false, status: 'failed' } : m))
    return false
  } finally {
    sending.value = false
  }
}

async function sendText() {
  const text = composerText.value.trim()
  if (!text) return
  composerText.value = ''
  await sendTextMessage(text)
}

/** Sends a text to the open conversation, as a pending bubble first; whether it went. */
async function sendTextMessage(raw: string): Promise<boolean> {
  const text = raw.trim()
  if (!text || !selected.value) return false
  sendError.value = ''
  const channel = replyChannel.value
  const target = selected.value

  const tempId = `pending-${Date.now()}`
  retryPayloads.value[tempId] = { kind: 'text', text, channel }
  pendingMessages.value = [
    ...pendingMessages.value,
    {
      id: tempId,
      patient_id: target.patientId,
      phone_number: target.phoneNumber,
      external_contact_id: target.externalContactId,
      lead_id: target.leadId,
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
      notBefore: newestInThread(target.key),
    },
  ]
  return performTextSend(tempId, text, channel, target)
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
        leadId: target.patientId ? undefined : target.leadId ?? undefined,
        phoneNumber: target.patientId || target.leadId ? undefined : target.phoneNumber,
        mediaBase64,
        mediaMimeType,
        mediaFilename,
        mediaKind,
      },
    })
    pendingMessages.value = pendingMessages.value.map((m) => (m.id === tempId ? { ...m, status: 'sent' } : m))
    // Quietly: a loud reload sets `loading`, which drops a thread that is
    // only a draft so far and skeletons the list behind it -- the sent
    // message blinked, and the list showed placeholders over real rows.
    await load({ silent: true })
    settlePending(tempId, threadExtra.value)
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
      external_contact_id: target.externalContactId,
      lead_id: target.leadId,
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
      notBefore: newestInThread(target.key),
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
    sendError.value = t('File is too large (max 16 MB).', 'El archivo es demasiado grande (máx. 16 MB).')
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
      sendError.value = err?.message ?? t('Could not process this image.', 'No se pudo procesar esta imagen.')
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
      sendError.value = t('Could not access the microphone — check permissions.', 'No se pudo acceder al micrófono; comprueba los permisos.')
    }
  }
}
function recordingLabel(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// The receptionist's suggested reply is offered when the patient wrote last
// and a free-form reply is still allowed.
const showReplyDraft = computed(() => {
  const sel = selected.value
  return !!sel?.patientId && !sel.leadId && within24h.value && hasReceptionist.value && thread.value.at(-1)?.direction === 'inbound'
})

// Fullscreen viewer for tapping any image in the thread (mine or theirs) --
// mediaUrls' signed URL already works as a direct download link.
const lightboxUrl = ref<string | null>(null)
// Teleported, it no longer goes away with the thread it was opened from.
watch(selectedKey, () => (lightboxUrl.value = null))

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}
// Same day-divider label as the web inbox (pages/inbox.vue) -- kept as its
// own copy rather than a shared util since mobile already duplicates the
// rest of this Message/Conversation logic rather than importing from web.
function relativeDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diffDays = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
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
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(locale.value, { weekday: 'long' })
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
// The web Inbox's words for each kind of attachment (pages/inbox.vue).
const MEDIA_TYPE_LABELS: Record<string, [string, string]> = {
  image: ['Image', 'Imagen'],
  video: ['Video', 'Vídeo'],
  audio: ['Audio', 'Audio'],
  document: ['Document', 'Documento'],
  sticker: ['Sticker', 'Sticker'],
}
function mediaTypeLabel(mediaType: string): string {
  const pair = MEDIA_TYPE_LABELS[mediaType]
  return pair ? t(pair[0], pair[1]) : mediaType
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

// Silent -- these can fire on every incoming message, and re-showing the
// full "Loading…" list on each one was the same layout-jump the poll timer
// below also caused; load() already merges into the same arrays either way.
// A delivery receipt -- sent, delivered, read: three or four for every
// message -- changes one message's ticks, and each used to reload the whole
// Inbox: 1,000 messages, the list and the leads, from a phone. It is patched
// in place instead, as the web Inbox does. A message that changed
// conversation (linked to a patient, a lead converted) is not a receipt and
// still reloads; one that is not loaded here changes nothing on screen.
function onMessageUpdate(payload: { new: Record<string, unknown> }) {
  const next = payload.new as Partial<Message>
  if (!next.id) return
  const patch = (list: Message[]) => {
    const i = list.findIndex((m) => m.id === next.id)
    if (i === -1) return null
    const current = list[i]!
    if (keyOf({ patient_id: next.patient_id ?? null, phone_number: next.phone_number ?? null, external_contact_id: next.external_contact_id ?? null, lead_id: next.lead_id ?? null }) !== keyOf(current)) return 'moved'
    // A receipt moves the ticks; a reaction (or one taken back) changes the
    // chip on the bubble. Both in place.
    const status = next.status ?? current.status
    const reaction = 'contact_reaction' in next ? (next.contact_reaction ?? null) : (current.contact_reaction ?? null)
    if (status === current.status && reaction === (current.contact_reaction ?? null)) return list
    const copy = list.slice()
    copy[i] = { ...current, status, contact_reaction: reaction }
    return copy
  }
  const inThread = patch(threadExtra.value)
  if (inThread === 'moved') {
    scheduleLoad()
    return
  }
  if (inThread) threadExtra.value = inThread
}

let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('mobile-inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, () => scheduleLoad())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${props.accountId}` }, onMessageUpdate)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `account_id=eq.${props.accountId}` }, () => scheduleLoad())
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
// Realtime fires once per change, and every WhatsApp delivered/read receipt
// is a change: a busy hour reloaded the whole Inbox many times a minute.
// Changes arriving together now cause one reload.
let reloadTimer: ReturnType<typeof setTimeout> | undefined
function scheduleLoad() {
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => load({ silent: true }), 600)
}
// The poll is only a safety net for a dropped realtime connection, so it
// rests while the app is in the background and catches up on return.
function onInboxVisible() {
  if (document.visibilityState === 'visible') scheduleLoad()
}
onMounted(() => document.addEventListener('visibilitychange', onInboxVisible))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onInboxVisible)
  clearTimeout(reloadTimer)
})
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // A minute, as on the web: realtime is what brings a new message in, and
  // every poll re-reads the message window and the list.
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && active.value) load({ silent: true })
  }, 60000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const listEl = ref<HTMLElement | null>(null)
// The Inbox page is kept alive between tabs, so an open chat is still open on
// the way back. The poll rests meanwhile; coming back catches up, and a chat
// that was left open is read again, so what arrived is marked read as seen.
const { active } = useKeptAlive({
  scrollers: [listEl, messagesEl],
  onReturn: () => {
    scheduleLoad()
    if (selectedKey.value) markRead(selectedKey.value)
  },
})
const { pulling, refreshing: pullRefreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(listEl, () => load({ silent: true }))
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <!-- Conversation list: always mounted underneath the thread overlay. On a
         wide iPad (lg) it keeps a 340px column and the thread opens beside it. -->
    <div class="absolute inset-0 flex min-h-0 flex-col bg-surface lg:right-auto lg:w-[340px] lg:border-r lg:border-line">
      <div v-if="!selectionMode" class="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <input
          v-model="search"
          type="search"
          :placeholder="t('Search name, number, messages…', 'Nombre, nº o mensaje')"
          class="h-9 flex-1 rounded-ctl border border-line-control bg-surface-subtle px-3 text-[14px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        <button type="button" class="shrink-0 px-1 text-[13px] font-medium text-brand-text" @click="selectionMode = true">{{ t('Select', 'Seleccionar') }}</button>
      </div>
      <div v-if="!selectionMode" class="shrink-0 border-b border-line bg-surface px-3 pb-2.5 pt-1" data-cy="inbox-chips">
        <div class="flex items-center gap-2">
          <div role="tablist" :aria-label="t('View', 'Vista')" class="grid flex-1 grid-cols-3 gap-[3px] rounded-ctl bg-chip-bg p-[3px]">
            <button
              v-for="s in ([['all', t('All', 'Todas'), 0], ['awaiting', t('To answer', 'Por responder'), awaitingCount], ['ai', t('AI', 'IA'), aiCount]] as const)"
              :key="s[0]"
              type="button"
              role="tab"
              :aria-selected="segment === s[0]"
              class="flex h-9 min-w-0 items-center justify-center gap-1 rounded-[7px] px-1 text-[13px]"
              :class="segment === s[0] ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'"
              :data-cy="`inbox-view-${s[0]}`"
              @click="setSegment(s[0])"
            >
              <span class="truncate">{{ s[1] }}</span>
              <span v-if="s[2]" class="shrink-0 text-[11.5px] font-bold" :class="s[0] === 'ai' ? 'text-brand-text' : 'text-ink-muted2'">{{ s[2] }}</span>
            </button>
          </div>
          <button
            type="button"
            class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-700"
            :aria-label="activeFilterChips.length ? t(`Filters, ${activeFilterChips.length} on`, `Filtros, ${activeFilterChips.length} activos`) : t('Filters', 'Filtros')"
            data-cy="inbox-filters-open"
            @click="filtersOpen = true"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h14M5.5 10h9M8 14.5h4" /></svg>
            <span v-if="activeFilterChips.length" class="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-white">{{ activeFilterChips.length }}</span>
          </button>
        </div>
        <!-- Only what is narrowing the list, each with its own way out -->
        <div v-if="activeFilterChips.length" class="mt-2 flex flex-wrap gap-1.5" data-cy="inbox-active-filters">
          <button
            v-for="c in activeFilterChips"
            :key="c.key"
            type="button"
            class="flex h-8 items-center gap-1 rounded-full border border-brand-tintBorder bg-brand-tint pl-3 pr-2 text-[12.5px] font-semibold text-brand-text"
            :aria-label="t(`Remove the ${c.label} filter`, `Quitar el filtro ${c.label}`)"
            @click="c.clear()"
          >
            {{ c.label }}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </div>
      <div v-else class="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
        <button type="button" class="shrink-0 px-1 text-[13px] text-ink-muted2" @click="exitSelectionMode">{{ t('Cancel', 'Cancelar') }}</button>
        <p class="truncate text-[13px] text-ink-700">{{ t(`${selectedKeys.size} selected`, `${selectedKeys.size} seleccionadas`) }}</p>
        <div class="flex shrink-0 items-center gap-3">
          <button
            type="button"
            class="text-[13px] font-medium text-brand-text disabled:opacity-40"
            :disabled="selectedKeys.size === 0"
            @click="bulkArchiveSelected(view !== 'archived')"
          >
            {{ view === 'archived' ? t('Unarchive', 'Desarchivar') : t('Archive', 'Archivar') }}
          </button>
          <button type="button" class="text-[13px] font-medium text-brand-text disabled:opacity-40" :disabled="selectedKeys.size === 0" @click="bulkMarkUnreadSelected">{{ t('Unread', 'No leídas') }}</button>
          <!-- Last, at the right edge: its menu is 256px wide and opens leftwards
               from the button, so anything after it pushed the menu off the
               left of a phone screen -- by ~17px in Spanish, where "Archivar"
               and "No leídas" are wider than "Archive" and "Unread". -->
          <InboxLabelPicker
            :labels="labels"
            :applied-ids="[]"
            @toggle-label="(id: string) => toggleLabelForKeys(id, [...selectedKeys])"
            @create-label="(name: string, color: string) => createLabel(name, color, [...selectedKeys])"
          />
        </div>
      </div>
      <div
        ref="listEl"
        class="flex-1 overflow-y-auto"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      >
        <div
          v-if="pulling || pullRefreshing || pullDistance > 0"
          class="flex items-center justify-center overflow-hidden transition-[height]"
          :style="{ height: pullRefreshing ? '56px' : `${pullDistance}px` }"
        >
          <!-- A thumb-sized disc, turning as it is pulled: the bare 16px icon was
             hard to see under a finger. -->
          <span class="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface shadow-card">
            <svg viewBox="0 0 24 24" class="h-[22px] w-[22px] text-brand" :class="{ 'animate-spin': pullRefreshing }" :style="pullRefreshing ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M4 12a8 8 0 0 1 14.5-4.6M20 12a8 8 0 0 1-14.5 4.6" />
            <path d="M17.5 3v5h-5M6.5 21v-5h5" />
          </svg>
          </span>
        </div>
        <!-- Only while there is nothing to show yet. The rows below render
             whatever `loading` says, so a skeleton drawn over a list that is
             already there read as placeholders mixed in with conversations. -->
        <AppSkeletonList v-if="loading && filteredConversations.length === 0" avatar :rows="7" />
        <p v-else-if="!loading && filteredConversations.length === 0" class="p-6 text-center text-[13px] text-ink-faint">
          {{ view === 'archived' ? t('No archived conversations.', 'No hay conversaciones archivadas.') : view === 'snoozed' ? t('Nothing snoozed.', 'Nada pospuesto.') : t('No conversations yet.', 'Aún no hay conversaciones.') }}
        </p>
        <div v-for="c in filteredConversations" :key="c.key" class="relative overflow-hidden border-b border-line-row">
          <!-- Only there while the row is swiped: left drawn underneath, a
               sliver of it showed below every row as a coloured line. -->
          <div class="absolute inset-y-0 right-0 flex" :class="swipedKey === c.key || draggingKey === c.key ? '' : 'invisible'">
            <button type="button" class="flex w-[76px] items-center justify-center bg-brand text-[12px] font-medium text-white" @click="toggleUnread(c)">
              {{ c.unread ? t('Read', 'Leída') : t('Unread', 'No leída') }}
            </button>
            <button type="button" class="flex w-[76px] items-center justify-center bg-ink-muted text-[12px] font-medium text-white" @click="toggleArchive(c)">
              {{ archivedKeys.has(c.key) ? t('Unarchive', 'Desarchivar') : t('Archive', 'Archivar') }}
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
            <template v-if="initialsOf(c.name)">{{ initialsOf(c.name) }}</template>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" /></svg>
            <span v-if="c.channel === 'whatsapp'" class="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-surface bg-[#25D366]" title="WhatsApp">
              <svg viewBox="0 0 24 24" class="h-[9px] w-[9px] fill-white"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4.2.5.7 1.7.7 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.4-.1.2-.3.4-.4.5-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.5 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.8.3.1.4.2.5.3.1.2.1.7-.1 1.3z" /></svg>
            </span>
            <span v-else class="absolute -bottom-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full border border-surface bg-brand" :title="t('In-app message', 'Mensaje en la app')">
              <svg viewBox="0 0 24 24" class="h-[9px] w-[9px] fill-white"><path d="M4 4h16v12H7l-3 3z" /></svg>
            </span>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-[14px] font-[560]" :class="c.unread ? 'text-ink-900' : 'text-ink-700'">
                {{ c.name }}
                <span v-if="c.leadId" class="font-normal text-ink-muted2">· {{ t('lead', 'lead') }}</span>
                <span v-if="c.phoneNumber && c.patientId" class="font-normal text-ink-faint">{{ c.phoneNumber }}</span>
              </p>
              <span class="shrink-0 text-[12px] text-ink-faint">{{ listTime(c.lastMessage.created_at) }}</span>
            </div>
            <p class="truncate text-[13px]" :class="c.unread ? 'font-medium text-ink-800' : 'text-ink-muted2'">
              {{ c.lastMessage.direction === 'outbound' ? t('You: ', 'Tú: ') : '' }}{{ previewText(c.lastMessage) }}
            </p>
            <!-- One status line, the label dots and who has it -->
            <div v-if="rowStatus(c) || myLabelsByKey[c.key]?.length || assignments[c.key]" class="mt-1 flex items-center gap-2">
              <span v-if="rowStatus(c)" class="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold" :class="STATUS_TONE[rowStatus(c)!.tone]" :data-cy="`inbox-row-${rowStatus(c)!.key}`">
                <svg v-if="rowStatus(c)!.icon === 'ai'" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.8l-3.7 2.3 1.1-4.3L2 6l4.4-.3z" /></svg>
                <svg v-else-if="rowStatus(c)!.icon === 'clock'" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="shrink-0" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.2 1.6" /></svg>
                <span v-else class="h-[7px] w-[7px] shrink-0 rounded-full bg-current" aria-hidden="true" />
                <span class="truncate">{{ rowStatus(c)!.text }}</span>
                <span v-if="rowStatus(c)!.key !== 'window' && windowPill(c)" class="shrink-0" :class="windowPill(c)!.urgent ? 'text-danger-text' : 'text-warning-text'" data-cy="inbox-row-window">· {{ windowPill(c)!.left }}</span>
              </span>
              <span v-if="myLabelsByKey[c.key]?.length" class="flex shrink-0 items-center gap-1" :aria-label="myLabelsByKey[c.key]!.map((lid) => labels.find((l) => l.id === lid)?.name).filter(Boolean).join(', ')">
                <span
                  v-for="lid in myLabelsByKey[c.key]"
                  :key="lid"
                  class="h-2 w-2 rounded-full"
                  :style="{ backgroundColor: labels.find((l) => l.id === lid)?.color }"
                  :title="labels.find((l) => l.id === lid)?.name"
                />
              </span>
              <!-- Who has it, as initials: the web list shows the same. -->
              <span
                v-if="assignments[c.key]"
                class="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-chip-border bg-chip-bg px-1 text-[9.5px] font-bold text-ink-700"
                :aria-label="t(`Assigned to ${assigneeName(c.key)}`, `Asignada a ${assigneeName(c.key)}`)"
                data-cy="inbox-row-owner"
              >{{ memberInitials(assignments[c.key]) }}</span>
            </div>
          </div>
          <span v-if="c.unread" class="mt-2 h-[9px] w-[9px] shrink-0 rounded-full bg-brand" />
          </button>
        </div>
        <button
          v-if="!loading && hasMoreSummaries && !search.trim()"
          type="button"
          class="block w-full py-4 text-center text-[13.5px] font-semibold text-brand-text disabled:text-ink-muted"
          :disabled="loadingMore"
          data-cy="inbox-load-more"
          @click="loadMoreSummaries"
        >
          {{ loadingMore ? t('Loading…', 'Cargando…') : t('Load older conversations', 'Cargar conversaciones anteriores') }}
        </button>
      </div>
    </div>

    <!-- Nothing open yet, beside the list on a wide iPad. -->
    <div v-if="!selectedKey" class="absolute inset-y-0 left-[340px] right-0 hidden items-center justify-center bg-surface-page px-6 text-center text-[14px] text-ink-muted lg:flex">
      {{ t('Choose a conversation.', 'Elige una conversación.') }}
    </div>

    <!-- Thread: overlay shown while open or animating closed via the back gesture -->
    <div
      v-if="selectedKey || swipeBack.active.value"
      ref="threadEl"
      class="absolute inset-0 z-30 flex min-h-0 flex-col bg-surface-page shadow-[-2px_0_12px_rgba(0,0,0,0.12)] lg:left-[340px] lg:shadow-none"
      :style="{
        transform: `translateX(${swipeBack.dragX.value}px)`,
        transition: swipeBack.dragging.value ? 'none' : 'transform 200ms ease-out',
        paddingBottom: keyboardHeight + 'px',
      }"
    >
      <template v-if="selected">
      <!-- The bar and the strip under it spaced alike: 8px between the
           buttons and the strip's pills, and 8px under them. -->
      <div class="shrink-0 border-b border-line bg-surface">
      <div class="flex h-[52px] items-center gap-2 px-3">
        <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-brand-text lg:hidden" :aria-label="t('Back to conversations', 'Volver a las conversaciones')" @click="selectedKey = null">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <p class="min-w-0 flex-1 truncate text-[15px] font-[650] text-ink-900" data-cy="thread-name">{{ selected.name }}</p>
        <InboxSnoozeMenu size="md" :snoozed-until="selected.snoozedUntil" :time-zone="staffContext?.timeZone" @snooze="(at: string) => snoozeKey(selected!.key, at)" @unsnooze="snoozeKey(selected!.key, null)" />
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-700" :aria-label="t('Assign', 'Asignar')" data-cy="inbox-assign" @click="assignOpen = true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6.5 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2 13.5c0-2.2 2-3.5 4.5-3.5 1 0 1.9.2 2.6.6M12 9.5v4M10 11.5h4" /></svg>
        </button>
        <button v-if="canLinkSelected" type="button" class="flex h-9 shrink-0 items-center rounded-ctl bg-brand px-2.5 text-[13px] font-semibold text-white" data-cy="inbox-link" @click="linkOpen = true">{{ t('Link', 'Vincular') }}</button>
        <!-- Record, the booking link and a payment link (InboxChatActions, as
             on the web); Book stays a button of its own, the one used most. -->
        <InboxChatActions
          v-if="!selected.leadId"
          size="md"
          :account-id="accountId"
          :patient-id="selected.patientId"
          :base-url="apiBase"
          :can-book="canBookFromThread"
          :can-pay="!!staffContext && (staffContext.isOwner || can('billing_access'))"
          :pay-link="(invoiceId: string) => authedFetch<{ url: string; remainingCents: number }>(`/api/invoices/${invoiceId}/pay-link`, { method: 'POST' })"
          @insert="insertReply"
          @book="navigateTo(`/patients/${selected!.patientId}?book=1`)"
          @open-record="navigateTo(`/patients/${selected!.patientId}`)"
        />
        <template v-if="selected.patientId">
          <NuxtLink v-if="canBookFromThread" :to="`/patients/${selected.patientId}?book=1`" class="flex h-9 shrink-0 items-center rounded-ctl bg-brand px-2.5 text-[13px] font-semibold text-white" data-cy="inbox-book">
            {{ t('Book', 'Reservar') }}
          </NuxtLink>
        </template>
      </div>
      <!-- Who this is, under the bar and the full width of it: the channel,
           their next visit (what most replies are about; tap to open it), or
           the number when there is no patient, and who has it. Squeezed in
           beside the name it was cut to "WhatsApp…" on a phone. -->
      <!-- As one line of text, not three pills: the channel, then the next
           visit (a link) or that nothing is booked, then who has it. -->
      <div class="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-4 pb-2 text-[12.5px] text-ink-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span class="inline-flex shrink-0 items-center gap-1.5">
          <span class="h-2 w-2 rounded-full" :class="selected.channel === 'whatsapp' ? 'bg-[#25D366]' : selected.channel === 'instagram' ? 'bg-[#D6249F]' : selected.channel === 'messenger' ? 'bg-[#0866FF]' : 'bg-brand'" aria-hidden="true" />
          {{ selected.channel === 'whatsapp' ? 'WhatsApp' : selected.channel === 'instagram' ? 'Instagram' : selected.channel === 'messenger' ? 'Messenger' : selected.channel === 'webchat' ? t('Website chat', 'Chat de la web') : t('In-app', 'App') }}
        </span>
        <template v-if="selected.patientId && nextVisitLoaded">
          <span aria-hidden="true">·</span>
          <NuxtLink v-if="nextVisit" :to="`/calendar/${nextVisit.id}`" class="shrink-0 font-medium text-brand-text" data-cy="thread-next-visit">{{ t('Next', 'Próxima') }}: {{ nextVisitWhen(nextVisit.starts_at) }}</NuxtLink>
          <span v-else class="shrink-0 font-semibold text-warning-text" data-cy="thread-next-visit">{{ t('Nothing booked', 'Sin cita') }}</span>
        </template>
        <template v-else-if="selected.phoneNumber"><span aria-hidden="true">·</span><span class="shrink-0">{{ selected.phoneNumber }}</span></template>
        <span v-if="assigneeName(selected.key)" class="shrink-0" data-cy="inbox-assignee">· {{ assigneeName(selected.key) }}</span>
      </div>
      </div>

      <!-- Who is answering, as the web Inbox says it under the header: the
           receptionist has it, a person took it over, or it handed this over
           and is waiting for one of you. No settings links: the app has no
           settings pages for the receptionist or the channel. -->
      <InboxAiBanner
        v-if="selected.leadId"
        :state="selectedLeadAi?.aiState ?? 'none'"
        kind="lead"
        :taken-over-by="selectedLeadAi?.takenOverBy"
        :reason="handoverReason"
        :quiet="receptionistQuiet"
        :links="false"
        @take-over="onLeadTakeOver"
        @hand-back="onLeadHandBack"
        @mark-handled="onLeadMarkHandled"
      />
      <InboxAiBanner
        v-else-if="selected.patientId && hasReceptionist && thread.length > 0"
        :state="patientAiStates[selected.patientId] ?? 'none'"
        kind="patient"
        :reason="handoverReason"
        :quiet="receptionistQuiet"
        :links="false"
        @mark-handled="onPatientMarkHandled"
      />

      <div ref="messagesEl" class="flex-1 space-y-2.5 overflow-y-auto overflow-x-hidden px-3 py-3">
        <div v-if="!threadReady" class="flex flex-col gap-2.5" data-cy="thread-loading">
          <div class="h-10 w-2/5 animate-pulse self-start rounded-card bg-surface-subtle" />
          <div class="h-14 w-3/5 animate-pulse self-start rounded-card bg-surface-subtle" />
          <div class="h-10 w-1/3 animate-pulse self-end rounded-card bg-surface-subtle" />
        </div>
        <template v-for="(m, i) in thread" :key="m.renderKey">
          <div
            v-if="i === 0 || relativeDay(m.created_at) !== relativeDay(thread[i - 1].created_at)"
            class="sticky top-0 z-10 -mx-3 flex justify-center py-1.5"
          >
            <span class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-chip-text">{{ relativeDay(m.created_at) }}</span>
          </div>
        <InboxNoteBubble v-for="n in notesBefore(i)" :key="n.id" :note="n" :team="teamNames" :mine="n.author_id === teamMemberId" @delete="removeNote(n.id)" />
        <!-- A reaction stored as its own line (before reactions went on the
        message, or to one QuiroFlow does not have): small, not a bubble. -->
        <p v-if="reactionEmoji(m.body_preview) && !m.media_type" class="flex justify-center text-[12px] text-ink-muted" data-testid="reaction-line">
          {{ t(`Reacted with ${reactionEmoji(m.body_preview)} · ${shortTime(m.created_at)}`, `Ha reaccionado con ${reactionEmoji(m.body_preview)} · ${shortTime(m.created_at)}`) }}
        </p>
        <div v-else class="flex" :class="[m.direction === 'outbound' ? 'justify-end' : 'justify-start', m.contact_reaction && 'pb-3.5']">
          <div
            class="relative min-w-0 max-w-[80%] rounded-card px-[8px] py-[6px] shadow-card [overflow-wrap:anywhere]"
            :class="[
              m.direction === 'outbound' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900',
              m.status === 'failed' && 'cursor-pointer',
            ]"
            @click="m.status === 'failed' && retryMessage(m)"
          >
            <!-- The receptionist answered on its own: said, for the team
            only -- the patient got the message alone. -->
            <p v-if="m.sent_by_ai" class="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[.04em] opacity-75" data-testid="message-ai">{{ t('AI receptionist', 'Recepcionista IA') }}</p>
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
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" class="shrink-0" aria-hidden="true">
                <path d="M4 1.5h5.5L12.5 4.5V14.5H4z" stroke-linejoin="round" />
                <path d="M9.5 1.5V4.5H12.5" stroke-linejoin="round" />
              </svg>
              <span class="min-w-0">{{ m.media_filename ?? t('Document', 'Documento') }}</span>
            </a>
            <img
              v-else-if="m.media_type === 'sticker' && m.media_storage_path && mediaUrls[m.media_storage_path]"
              :src="mediaUrls[m.media_storage_path]"
              class="h-24 w-24"
            />
            <p v-else-if="m.media_type" class="text-[12.5px] italic opacity-70">{{ m.pending ? t('Uploading…', 'Subiendo…') : t('Media unavailable', 'Contenido no disponible') }}</p>

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
            <InboxReactionBadge v-if="m.contact_reaction" :emoji="m.contact_reaction" :side="m.direction === 'outbound' ? 'right' : 'left'" />
          </div>
        </div>
        </template>
        <InboxNoteBubble v-for="n in notesAfterLast" :key="n.id" :note="n" :team="teamNames" :mine="n.author_id === teamMemberId" @delete="removeNote(n.id)" />
      </div>

      <div class="shrink-0 border-t border-line bg-surface p-3">
        <!-- One row for the two things beside the composer, as on web
             (pages/inbox.vue): a note for the team, always possible whatever
             WhatsApp's window says (it is never sent), and the
             receptionist's suggested reply when the patient wrote last. They
             were two stacked blocks, so the pills sat on separate lines. A
             drafted reply takes the row's full width (ReplyDraft). -->
        <div v-if="!noteMode && (thread.length > 0 || showReplyDraft)" class="mb-2 flex flex-wrap items-center gap-2">
          <button v-if="thread.length > 0" type="button" class="flex h-10 items-center gap-1.5 rounded-pill border border-warning-border bg-warning-bg px-3 text-[12.5px] font-semibold text-warning-text" data-cy="thread-note-open" @click="noteMode = true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            {{ t('Internal note', 'Nota interna') }}
          </button>
          <InboxReplyDraft
            v-if="showReplyDraft && selected.patientId"
            size="lg"
            :patient-id="selected.patientId"
            :draft-for="(id: string) => authedFetch<{ available: boolean; draft: string; refused?: boolean }>(`/api/inbox/patients/${id}/draft-reply`, { method: 'POST' })"
            :sending="sending"
            :stored="storedReplyDraft(selected.patientId)"
            @send="sendDraft"
            @edit="(text: string) => (composerText = text)"
          />
        </div>
        <!-- The receptionist's draft for a lead, waiting on a person: the
             same card a patient's waits in. Nothing reaches anyone unread. -->
        <div v-if="leadDraft && selected.leadId && !noteMode" class="mb-2" data-cy="lead-draft">
          <InboxAiDraftCard :draft="leadDraft.body" :at="leadDraft.at" :sending="sending" size="lg" @approve="approveLeadDraft" @discard="discardLeadDraft" />
        </div>
        <InboxNoteComposer v-if="noteMode" size="lg" :team="teamNames" :my-id="teamMemberId" :saving="noteSaving" :error="noteError" @save="saveNote" @cancel="noteMode = false" />
        <p v-if="sendError && !noteMode" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
        <template v-if="noteMode || !threadReady" />
        <!-- The composer opens only once a person has taken a lead's thread
             off the AI, as on the web (InboxLeadThread). -->
        <div v-else-if="selected.leadId && leadComposerLocked" class="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2.5" data-cy="inbox-composer-locked">
          <span class="text-[12.5px] text-ink-muted">{{ t('Composer locked while the AI is replying. Take over to write yourself.', 'Redacción bloqueada mientras responde la IA. Toma el control para escribir tú.') }}</span>
          <UiBtn variant="secondary" size="sm" class="h-10" data-cy="inbox-take-over" @click="onLeadTakeOver">{{ t('Take over', 'Tomar el control') }}</UiBtn>
        </div>
        <div v-else-if="selected.leadId && leadChannelBlocked" class="rounded-ctl border border-danger-border bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text" data-cy="inbox-channel-blocked">
          {{ t('Nothing can be sent until the number is reconnected.', 'No se puede enviar nada hasta reconectar el número.') }}
        </div>
        <div v-else-if="thread.length === 0 || !within24h" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text" data-cy="inbox-window-closed">
          <p>
            {{
              thread.length === 0
                ? t(
                    `No messages with ${selected.name} yet. WhatsApp only lets a clinic start a conversation with an approved template.`,
                    `Aún no hay mensajes con ${selected.name}. WhatsApp solo permite a una clínica iniciar una conversación con una plantilla aprobada.`,
                  )
                : !everWrote
                  ? t(
                      `${selected.name} hasn't written to you yet. Until they reply, WhatsApp only lets the clinic send an approved template.`,
                      `${selected.name} aún no te ha escrito. Hasta que responda, WhatsApp solo permite enviarle una plantilla aprobada.`,
                    )
                : replyChannel === 'instagram' || replyChannel === 'messenger'
                  ? t(
                      `More than 24h since ${selected.name} last messaged — free-form replies are blocked by ${replyChannel === 'messenger' ? 'Messenger' : 'Instagram'}.`,
                      `Han pasado más de 24h desde que ${selected.name} escribió por última vez — ${replyChannel === 'messenger' ? 'Messenger' : 'Instagram'} bloquea las respuestas libres.`,
                    )
                  : t(
                      `More than 24h since ${selected.name} last messaged — free-form replies are blocked by WhatsApp; only an approved template can be sent.`,
                      `Han pasado más de 24h desde que ${selected.name} escribió por última vez — WhatsApp bloquea las respuestas libres; solo se puede enviar una plantilla aprobada.`,
                    )
            }}
            <template v-if="templateTarget && contactBlocked">
              {{ t('This patient cannot be contacted (under age or marked do not contact).', 'A este paciente no se le puede contactar (menor de edad o marcado como no contactar).') }}
            </template>
            <template v-else-if="templateTarget && !templateAllowed">
              {{ t("Your role can't send templates.", 'Tu rol no puede enviar plantillas.') }}
            </template>
          </p>
          <AppButton v-if="canSendTemplate" variant="primary" class="mt-2 w-full" data-cy="inbox-send-template" @click="templateSheetOpen = true">
            {{ t('Send a template', 'Enviar una plantilla') }}
          </AppButton>
        </div>
        <div v-else-if="audioRecording" class="flex items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2.5">
          <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
          <span class="flex-1 text-[14px] text-ink-700">{{ t('Recording…', 'Grabando…') }} {{ recordingLabel(audioSeconds) }}</span>
          <button type="button" class="shrink-0 px-1.5 text-[12.5px] text-ink-faint" @click="cancelAudioRecording">{{ t('Cancel', 'Cancelar') }}</button>
          <UiBtn variant="primary" size="sm" @click="toggleAudioRecording">{{ t('Send', 'Enviar') }}</UiBtn>
        </div>
        <div v-else class="flex items-end gap-2">
          <InboxSavedRepliesPicker size="lg" @insert="insertReply" />
          <input ref="fileInput" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" class="hidden" @change="onFileChosen" />
          <!-- Attachments, camera and voice notes are WhatsApp-only: all three
               upload through whatsapp/inbox-send, and instagram/send posts
               text alone. On an Instagram thread they would take a file,
               upload it, and fail at the very last step. Same reasoning as
               the web Inbox. -->
          <button
            v-if="!['instagram', 'messenger', 'webchat'].includes(replyChannel)"
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            :title="t('Attach a file', 'Adjuntar archivo')" :aria-label="t('Attach a file', 'Adjuntar archivo')"
            @click="fileInput?.click()"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M8 2.5v11M2.5 8h11" />
            </svg>
          </button>
          <!-- Enter on a hardware keyboard sends (see the handler below), and
               enterkeyhint labels the virtual keyboard's own key "Send". Some
               Android keyboards show a newline key on a textarea anyway, so
               once there is text the camera and microphone give way to a Send
               button, as in WhatsApp. -->
          <!-- The placeholder is drawn here rather than by the textarea. The
               buttons beside it swap (camera and microphone, or Send) the
               moment the text is cleared, and iOS's WebKit repainted the
               native placeholder at the box's old width as well as its new
               one: two copies, overlapping. An element of our own is simply
               re-rendered. -->
          <div class="relative min-w-0 flex-1">
            <textarea
              ref="composerTextarea"
              v-model="composerText"
              rows="1"
              enterkeyhint="send"
              :aria-label="t('Message', 'Mensaje')"
              class="block max-h-24 min-h-11 w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
              data-cy="inbox-composer"
              @keydown.enter.exact.prevent="sendText"
            />
            <span v-if="!composerText" aria-hidden="true" class="pointer-events-none absolute inset-x-3 top-2.5 truncate text-[14px] text-ink-faint" data-cy="inbox-composer-placeholder">
              {{ t('Type a message…', 'Mensaje…') }}
            </span>
          </div>
          <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onFileChosen" />
          <button
            v-if="composerText.trim()"
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl bg-brand text-white disabled:opacity-50"
            :disabled="sending"
            :aria-label="t('Send', 'Enviar')"
            data-cy="inbox-send"
            @click="sendText"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
          <template v-else>
          <button
            v-if="!['instagram', 'messenger', 'webchat'].includes(replyChannel)"
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            :title="t('Take a photo', 'Hacer una foto')" :aria-label="t('Take a photo', 'Hacer una foto')"
            @click="cameraInput?.click()"
          >
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.2l.5-1h5.6l.5 1h1.2A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6Z" stroke-linejoin="round" />
              <circle cx="8" cy="8.2" r="2.3" />
            </svg>
          </button>
          <button
            v-if="!['instagram', 'messenger', 'webchat'].includes(replyChannel)"
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted disabled:opacity-50"
            :disabled="sending"
            :title="t('Record a voice note', 'Grabar una nota de voz')" :aria-label="t('Record a voice note', 'Grabar una nota de voz')"
            @click="toggleAudioRecording"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
              <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" stroke-linecap="round" />
            </svg>
          </button>
          </template>
        </div>
      </div>
      </template>
    </div>

    <!-- The filters behind the Filters button: who it is assigned to, who is
         writing, the narrower ones, labels, and the snoozed and archived. -->
    <div v-if="filtersOpen" class="absolute inset-0 z-40 flex flex-col justify-end bg-black/30 md:items-center md:justify-center" data-cy="inbox-filters-sheet" @click.self="filtersOpen = false">
      <div v-sheet-drag="() => (filtersOpen = false)" role="dialog" aria-modal="true" :aria-label="t('Filters', 'Filtros')" class="flex max-h-[88%] w-full flex-col gap-4 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[440px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)">
        <div class="mx-auto h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
        <div class="flex items-center justify-between">
          <p class="text-[17px] font-semibold text-ink-900">{{ t('Filters', 'Filtros') }}</p>
          <button type="button" class="-my-2 h-10 px-1 text-[14px] font-semibold text-brand-text disabled:opacity-40" :disabled="!activeFilterChips.length" @click="clearFilters(); filtersOpen = false">{{ t('Clear', 'Limpiar') }}</button>
        </div>

        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Assigned to', 'De quién') }}</legend>
          <div class="grid grid-cols-3 gap-[3px] rounded-ctl bg-chip-bg p-[3px]">
            <button v-for="o in ([['all', t('Anyone', 'Todas')], ['mine', t('Me', 'Mías')], ['unassigned', t('Nobody', 'Sin asignar')]] as const)" :key="o[0]" type="button" :aria-pressed="assignFilter === o[0]" class="h-9 rounded-[7px] text-[13px]" :class="assignFilter === o[0] ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'" :data-cy="o[0] === 'all' ? undefined : `inbox-filter-${o[0]}`" @click="assignFilter = o[0]">{{ o[1] }}</button>
          </div>
        </fieldset>

        <fieldset v-if="leadThreadsAreSeparate" class="flex flex-col gap-1.5">
          <legend class="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Who is writing', 'Quién escribe') }}</legend>
          <div class="grid grid-cols-3 gap-[3px] rounded-ctl bg-chip-bg p-[3px]">
            <button v-for="o in ([['all', t('Everyone', 'Todos')], ['patients', t('Patients', 'Pacientes')], ['leads', t('Leads', 'Leads')]] as const)" :key="o[0]" type="button" :aria-pressed="sourceFilter === o[0]" class="h-9 rounded-[7px] text-[13px]" :class="sourceFilter === o[0] ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'" :data-cy="o[0] === 'all' ? undefined : `inbox-chip-${o[0]}`" @click="sourceFilter = o[0]">{{ o[1] }}</button>
          </div>
        </fieldset>

        <fieldset class="flex flex-col">
          <legend class="mb-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Only', 'Solo') }}</legend>
          <label class="flex min-h-12 items-center justify-between gap-3 border-b border-line-row text-[15px] text-ink-900">
            <span>{{ t('Unread', 'No leídas') }} <span v-if="unreadCount" class="text-[13px] text-ink-muted2">· {{ unreadCount }}</span></span>
            <input v-model="unreadOnly" type="checkbox" class="h-5 w-5 accent-brand" data-cy="inbox-chip-unread" />
          </label>
          <label class="flex min-h-12 items-center justify-between gap-3 border-b border-line-row text-[15px] text-ink-900">
            <span>{{ t('WhatsApp about to close', 'WhatsApp a punto de cerrar') }} <span v-if="expiringCount" class="text-[13px] text-ink-muted2">· {{ expiringCount }}</span></span>
            <input v-model="expiringOnly" type="checkbox" class="h-5 w-5 accent-brand" data-cy="inbox-chip-expiring" />
          </label>
          <label class="flex min-h-12 items-center justify-between gap-3 border-b border-line-row text-[15px] text-ink-900">
            <span>{{ t('AI draft ready', 'Borrador de la IA listo') }} <span v-if="draftReadyCount" class="text-[13px] text-ink-muted2">· {{ draftReadyCount }}</span></span>
            <input v-model="draftReadyOnly" type="checkbox" class="h-5 w-5 accent-brand" data-cy="inbox-chip-draft-ready" />
          </label>
          <label class="flex min-h-12 items-center justify-between gap-3 text-[15px] text-ink-900">
            <span>{{ t('Handed to a person', 'Pasadas a una persona') }} <span v-if="needsHumanCount" class="text-[13px] text-ink-muted2">· {{ needsHumanCount }}</span></span>
            <input v-model="needsHumanOnly" type="checkbox" class="h-5 w-5 accent-brand" data-cy="inbox-chip-needs-human" />
          </label>
        </fieldset>

        <fieldset v-if="labels.length" class="flex flex-col gap-1.5">
          <legend class="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Label', 'Etiqueta') }}</legend>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="l in labels"
              :key="l.id"
              type="button"
              :class="chipClass(labelFilter === l.id)"
              :aria-pressed="labelFilter === l.id"
              @click="labelFilter = labelFilter === l.id ? null : l.id"
            >
              <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: l.color }" />{{ l.name }}
            </button>
          </div>
        </fieldset>

        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Show', 'Ver') }}</legend>
          <div class="grid grid-cols-3 gap-[3px] rounded-ctl bg-chip-bg p-[3px]">
            <button v-for="o in ([['active', t('Active', 'Activas')], ['snoozed', t('Snoozed', 'Pospuestas')], ['archived', t('Archived', 'Archivadas')]] as const)" :key="o[0]" type="button" :aria-pressed="view === o[0]" class="h-9 rounded-[7px] text-[13px]" :class="view === o[0] ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'" :data-cy="o[0] === 'snoozed' ? 'inbox-snoozed-toggle' : o[0] === 'archived' ? 'inbox-archived-toggle' : undefined" @click="view = o[0]">{{ o[1] }}</button>
          </div>
        </fieldset>

        <AppButton variant="primary" data-cy="inbox-filters-done" @click="filtersOpen = false">
          {{ t(`Show ${filteredConversations.length} ${filteredConversations.length === 1 ? 'conversation' : 'conversations'}`, `Ver ${filteredConversations.length} ${filteredConversations.length === 1 ? 'conversación' : 'conversaciones'}`) }}
        </AppButton>
      </div>
    </div>

    <!-- Assign the open conversation -->
    <div v-if="assignOpen && selected" class="absolute inset-0 z-40 flex flex-col justify-end bg-black/30 md:items-center md:justify-center" data-cy="inbox-assign-sheet" @click.self="assignOpen = false">
      <div v-sheet-drag="() => (assignOpen = false)" class="flex max-h-[80%] w-full flex-col gap-1 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-3 shadow-popover md:max-w-[380px] md:rounded-[18px] md:pt-4" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)" role="dialog" aria-modal="true" :aria-label="t('Assign', 'Asignar')">
        <p class="px-1 pb-1 text-[16px] font-semibold text-ink-900">{{ t('Assign to', 'Asignar a') }}</p>
        <button
          v-for="m in [{ id: '', full_name: t('Nobody (unassigned)', 'Nadie (sin asignar)') }, ...teamNames]"
          :key="m.id || 'none'"
          type="button"
          class="flex min-h-11 items-center justify-between rounded-ctl px-3 text-left text-[14.5px]"
          :class="(assignments[selected.key] ?? '') === m.id ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-900'"
          data-cy="inbox-assign-option"
          @click="assign(selected.key, m.id || null)"
        >
          {{ m.id === teamMemberId ? t(`${m.full_name} (me)`, `${m.full_name} (yo)`) : m.full_name }}
        </button>
      </div>
    </div>
    <InboxLinkSheet v-if="linkOpen && selected?.phoneNumber" :phone-number="selected.phoneNumber" @linked="onLinked" @close="linkOpen = false" />

    <WhatsAppTemplateSheet
      v-if="templateSheetOpen && selected && canSendTemplate"
      :patient-id="selected.patientId"
      :phone-number="selected.patientId ? null : selected.phoneNumber"
      :lead-id="selected.patientId ? null : selected.leadId"
      :patient-first-name="selected.patientId || selected.leadId ? selected.name.split(' ')[0] : undefined"
      @close="templateSheetOpen = false"
      @sent="onTemplateSent"
    />

    <!-- Teleported to <body>, like the patient-files viewer
         (StaffPatientFiles.vue): rendered in place, it lived inside the
         inbox's own layout, where the screen's header and tab bar could sit
         over its close button and leave the photo with no way out. -->
    <Teleport to="body">
    <div v-if="lightboxUrl" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6" data-cy="inbox-lightbox" @click="lightboxUrl = null">
      <img :src="lightboxUrl" class="max-h-full max-w-full rounded-ctl object-contain" @click.stop />
      <div class="absolute right-4 flex gap-2" style="top: calc(env(safe-area-inset-top) + 12px)">
        <a :href="lightboxUrl" download target="_blank" class="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" :title="t('Download', 'Descargar')" :aria-label="t('Download', 'Descargar')" @click.stop>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <button type="button" class="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" :title="t('Close', 'Cerrar')" :aria-label="t('Close', 'Cerrar')" data-cy="inbox-lightbox-close" @click.stop="lightboxUrl = null">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M3 3l10 10M13 3 3 13" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
    </Teleport>
    <div v-if="notice" class="pointer-events-none absolute inset-x-0 bottom-20 z-50 flex justify-center px-4" role="status" data-cy="inbox-snooze-notice">
      <p class="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-surface shadow-popover">{{ notice }}</p>
    </div>
  </div>
</template>
