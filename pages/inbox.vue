<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'
import { CHANNEL_LABEL } from '~/composables/useGrowthConversations'

// The Inbox: one row per conversation from the inbox_conversations view
// (20260924190000), 50 at a time, filtered and searched by the database --
// rather than the latest 1,000 WhatsApp and 1,000 in-app messages grouped in
// the browser, which dropped every older conversation off the list and out
// of search, and re-downloaded all 2,000 every 15 seconds. The open thread
// loads its own messages.
//
// Read status, archive and labels are each person's own; who a conversation
// is assigned to is the team's. Conversations are archived, never deleted:
// messages are part of the patient's record.

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
  /** Who the conversation is with when there is no phone -- an Instagram IGSID. */
  external_contact_id: string | null
  created_at: string
  pending?: boolean
}
interface Conversation {
  key: string
  patientId: string | null
  phoneNumber: string | null
  /** Set instead of phoneNumber on a channel that has no phone, e.g. Instagram. */
  externalContactId?: string | null
  name: string
  channel: string
  lastMessage: Message | null
  unread: boolean
  assignedTo?: string | null
  labelIds?: string[]
  archived?: boolean
}
interface InboxRow {
  conversation_key: string
  patient_id: string | null
  phone_number: string | null
  external_contact_id: string | null
  first_name: string | null
  last_name: string | null
  last_channel: string
  last_direction: string
  last_status: string
  last_body: string | null
  last_template_name: string | null
  last_media_type: string | null
  last_at: string
  last_inbound_at: string | null
  assigned_to: string | null
  unread_for_me: boolean
  my_archived: boolean
  my_label_ids: string[]
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
const { refresh: refreshNavBadges } = useNavBadges()

// Messages this tab has sent but the server hasn't confirmed into the real
// table yet -- rendered inline with a clock icon so the composer clears and
// the message appears immediately (WhatsApp-style) instead of waiting on
// the round trip. A reload naturally supersedes one once the real row shows
// up; on failure it's kept and flipped to a failed status instead of
// vanishing.
const pendingMessages = ref<Message[]>([])

const rows = ref<InboxRow[]>([])
const hasMore = ref(false)
const loadingMore = ref(false)
const patients = ref<PatientOption[]>([])
const loading = ref(true)
const ready = ref(false)
const search = ref('')

function keyOf(m: { patient_id: string | null; phone_number: string | null; external_contact_id: string | null }) {
  return m.patient_id ?? m.phone_number ?? m.external_contact_id ?? 'unknown'
}

const CHANNEL_NAMES: Record<string, [string, string]> = {
  whatsapp: ['WhatsApp', 'WhatsApp'],
  instagram: ['Instagram', 'Instagram'],
  in_app: ['App', 'App'],
}
function channelName(channel: string) {
  const pair = CHANNEL_NAMES[channel]
  return pair ? t(pair[0], pair[1]) : (CHANNEL_LABEL[channel] ?? channel)
}

function toConversation(r: InboxRow): Conversation {
  return {
    key: r.conversation_key,
    patientId: r.patient_id,
    phoneNumber: r.phone_number,
    externalContactId: r.external_contact_id,
    name: (r.patient_id && `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || r.phone_number || t('Unknown', 'Desconocido'),
    channel: r.last_channel,
    lastMessage: {
      id: `head-${r.conversation_key}`,
      patient_id: r.patient_id,
      phone_number: r.phone_number,
      external_contact_id: r.external_contact_id,
      direction: r.last_direction,
      status: r.last_status,
      body_preview: r.last_body,
      template_name: r.last_template_name,
      media_type: r.last_media_type,
      media_storage_path: null,
      media_mime_type: null,
      media_filename: null,
      channel: r.last_channel,
      created_at: r.last_at,
    },
    unread: r.unread_for_me,
    assignedTo: r.assigned_to,
    labelIds: r.my_label_ids ?? [],
    archived: r.my_archived,
  }
}
const conversations = computed<Conversation[]>(() => rows.value.map(toConversation))
const myLabelsByKey = computed<Record<string, string[]>>(() => Object.fromEntries(rows.value.map((r) => [r.conversation_key, r.my_label_ids ?? []])))

// The shared label catalogue; which labels sit on which conversation is each
// person's own and arrives with the rows.
interface LabelDef {
  id: string
  name: string
  color: string
}
const labels = ref<LabelDef[]>([])
async function loadLabels() {
  const { data } = await supabase.from('whatsapp_labels').select('id, name, color').order('name')
  labels.value = data ?? []
}
onMounted(loadLabels)

// Who a conversation can be assigned to.
const team = ref<{ id: string; full_name: string }[]>([])
onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').is('deleted_at', null).order('full_name')
  team.value = data ?? []
})
const myId = computed(() => store.teamMember?.id ?? null)
function memberName(id: string | null | undefined) {
  if (!id) return null
  if (id === myId.value) return t('You', 'Tú')
  return team.value.find((m) => m.id === id)?.full_name ?? t('Someone', 'Alguien')
}
function memberInitials(id: string | null | undefined) {
  if (!id) return ''
  if (id === myId.value) return t('Me', 'Tú')
  const name = team.value.find((m) => m.id === id)?.full_name ?? '?'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

// --- The list -----------------------------------------------------------------
const PAGE = 50
// Archived view: toggled by a single icon button rather than a filter chip,
// since it's a whole different list (not a narrowing of the active one) --
// compose doesn't make sense there either, see the template.
const view = ref<'active' | 'archived'>('active')
const tab = ref<'all' | 'mine' | 'unassigned'>('all')
const unreadOnly = ref(false)
// "awaiting_us"/"awaiting_patient" is deliberately independent from unread:
// unread means "I haven't opened this," awaiting-us means "the last message
// is theirs, regardless of whether I've read it" -- a conversation I've
// already read but haven't replied to is exactly the case this filter
// exists to surface that "unread" alone would miss.
const replyFilter = ref<'all' | 'awaiting_us' | 'awaiting_patient'>('all')
const labelFilter = ref<string | null>(null)
const counts = ref({ all: 0, mine: 0, unassigned: 0, unread: 0 })

// Text search covers what was said, not only names and numbers: the keys of
// conversations with a matching message join the name/number match.
function cleanTerm(q: string) {
  return q.replace(/[,()*"\\%]/g, ' ').trim()
}
async function keysMatchingText(q: string): Promise<string[]> {
  const [wa, app] = await Promise.all([
    supabase
      .from('whatsapp_messages')
      .select('patient_id, phone_number, external_contact_id')
      .ilike('body_preview', `%${q}%`)
      .or('lead_id.is.null,patient_id.not.is.null')
      .limit(200),
    supabase.from('patient_app_messages').select('patient_id').ilike('body', `%${q}%`).limit(200),
  ])
  const keys = new Set<string>()
  for (const m of wa.data ?? []) keys.add(keyOf(m as any))
  for (const m of app.data ?? []) keys.add(m.patient_id)
  return [...keys]
}

// Every list query and count shares these, so a count always describes the
// list beside it.
function inboxQuery(columns: string, opts?: { count: 'exact'; head: true }) {
  return supabase.from('inbox_conversations').select(columns, opts).eq('my_archived', view.value === 'archived')
}

let listToken = 0
async function loadList(opts: { silent?: boolean; append?: boolean } = {}) {
  const token = ++listToken
  if (!opts.silent && !opts.append) loading.value = true
  if (opts.append) loadingMore.value = true
  const from = opts.append ? rows.value.length : 0
  // A silent refresh keeps however many rows are already showing, so new
  // messages arriving never collapse a list someone has scrolled through.
  const size = opts.silent ? Math.max(PAGE, rows.value.length) : PAGE

  let q = inboxQuery('*')
  if (tab.value === 'mine') q = q.eq('assigned_to', myId.value ?? '')
  else if (tab.value === 'unassigned') q = q.is('assigned_to', null)
  if (unreadOnly.value) q = q.eq('unread_for_me', true)
  if (replyFilter.value === 'awaiting_us') q = q.eq('last_direction', 'inbound')
  else if (replyFilter.value === 'awaiting_patient') q = q.eq('last_direction', 'outbound')
  if (labelFilter.value) q = q.contains('my_label_ids', [labelFilter.value])
  const term = cleanTerm(search.value)
  if (term) {
    const keys = await keysMatchingText(term)
    const parts = [`search_name.ilike.*${normalizeSearchTerm(term)}*`, `phone_number.ilike.*${term}*`]
    if (keys.length) parts.push(`conversation_key.in.(${keys.map((k) => `"${k}"`).join(',')})`)
    q = q.or(parts.join(','))
  }
  const { data, error } = await q.order('last_at', { ascending: false }).range(from, from + size)
  if (token !== listToken) return
  if (error) {
    loading.value = false
    loadingMore.value = false
    return
  }
  const page = (data ?? []) as unknown as InboxRow[]
  hasMore.value = page.length > size
  const trimmed = page.slice(0, size)
  rows.value = opts.append ? [...rows.value, ...trimmed] : trimmed
  loading.value = false
  loadingMore.value = false
  loadCounts()
}

async function loadCounts() {
  const count = (fn: (q: ReturnType<typeof inboxQuery>) => PromiseLike<{ count: number | null }>) => fn(inboxQuery('conversation_key', { count: 'exact', head: true })).then((r) => r.count ?? 0)
  const [all, mine, unassigned, unread] = await Promise.all([
    count((q) => q),
    count((q) => q.eq('assigned_to', myId.value ?? '')),
    count((q) => q.is('assigned_to', null)),
    count((q) => q.eq('unread_for_me', true)),
  ])
  counts.value = { all, mine, unassigned, unread }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadList(), 300)
})
watch([view, tab, unreadOnly, replyFilter, labelFilter], () => loadList())

onMounted(async () => {
  if (!store.teamMember) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => store.teamMember, (v) => {
        if (v) {
          stop()
          resolve()
        }
      }, { immediate: true })
    })
  }
  await loadList()
  ready.value = true
})
// Bounded on purpose -- this only backs the "New" picker's empty-query
// browse list; searchComposePatients below queries the DB directly.
onMounted(async () => {
  const { data } = await supabase.from('patients').select('id, first_name, last_name').order('first_name').limit(20)
  patients.value = data ?? []
})


// --- Growth tier -------------------------------------------------------
// Lead conversations live in their own list and are merged in only at the
// display layer, never into `conversations` above. That keeps every real
// whatsapp_messages code path -- thread grouping, unread, delete, ticks,
// sending -- untouched, and guarantees a real patient thread can never be
// decorated with AI state that does not exist for it. Without the tier
// nothing below loads and this page is exactly what it was.
const { hasGrowth } = useGrowthTier()
const { conversations: leadConversations, reload: reloadLeadConversations, takeOver, handBack } = useGrowthConversations(hasGrowth)
const {
  thread: leadThread,
  sending: leadSending,
  drafting: leadDrafting,
  load: loadLeadThread,
  reply: replyToLead,
  draftReply: draftLeadReply,
  discardDraft: discardLeadDraft,
  approveDraft: approveLeadDraft,
  close: closeLeadThread,
} = useGrowthLeadThread()

// Only "AI handling" and "Needs human" are here. The design also draws
// Unassigned and Mine, which need a per-conversation owner -- leads could
// carry one but the real patient threads beside them cannot, so the filter
// would mean two different things in one list. They arrive with the leads
// endpoint, which is what gives both sides an owner.
const aiFilter = ref<'all' | 'ai_handling' | 'needs_human' | 'draft_ready'>('all')

// Leads sit above the patient threads in one list, which is the right call --
// one person, one thread, and a lead who becomes a patient does not move.
// But the front desk's question is usually "has a PATIENT written to us",
// and on a busy lead day the answer is buried under people who are not
// patients yet. This narrows the list to one side or the other; the badge on
// each lead row is what answers the same question without touching a filter.
const sourceFilter = ref<'all' | 'leads' | 'patients'>('all')

// Growth > Conversations in the sidebar is a saved view into this inbox, not
// a screen of its own -- it deep-links here with the filter already applied.
// Read once on mount rather than watched: after landing, the chips are the
// user's to change, and re-applying the query on every navigation would
// fight them.
onMounted(() => {
  const q = useRoute().query.ai
  if (q === 'handling') aiFilter.value = 'ai_handling'
  else if (q === 'needs_human') aiFilter.value = 'needs_human'
})

// Everything except the leads/patients split, so the chip counts can be
// read off this. Counting the visible list instead would make "Leads · 3"
// become "Leads · 0" the moment you clicked "Patients", which reads as the
// leads having gone somewhere.
const leadConversationsInView = computed(() => {
  if (!hasGrowth.value || view.value === 'archived') return []
  let list = leadConversations.value
  if (search.value.trim()) {
    const q = normalizeSearchTerm(search.value.trim())
    list = list.filter((c) => normalizeSearchTerm(`${c.name} ${c.preview}`).includes(q))
  }
  if (unreadOnly.value) list = list.filter((c) => c.unread)
  if (aiFilter.value === 'ai_handling') list = list.filter((c) => c.aiState === 'handling')
  else if (aiFilter.value === 'needs_human') list = list.filter((c) => c.aiState === 'needs_human' || c.aiState === 'blocked')
  else if (aiFilter.value === 'draft_ready') list = list.filter((c) => c.hasDraft)
  return list
})

const visibleLeadConversations = computed(() => {
  if (sourceFilter.value === 'patients') return []
  if (tab.value === 'mine') return leadConversationsInView.value.filter((c) => leadOwners.value[c.key] === myId.value)
  if (tab.value === 'unassigned') return leadConversationsInView.value.filter((c) => !leadOwners.value[c.key])
  return leadConversationsInView.value
})
// The tabs count leads too, so "Mine · 3" means three rows under it.
const tabCounts = computed(() => {
  const leads = view.value === 'archived' ? [] : leadConversationsInView.value
  return {
    all: counts.value.all + leads.length,
    mine: counts.value.mine + leads.filter((c) => leadOwners.value[c.key] === myId.value).length,
    unassigned: counts.value.unassigned + leads.filter((c) => !leadOwners.value[c.key]).length,
  }
})

const aiHandlingCount = computed(() => leadConversations.value.filter((c) => c.aiState === 'handling').length)
const needsHumanCount = computed(() => leadConversations.value.filter((c) => c.aiState === 'needs_human' || c.aiState === 'blocked').length)
// Threads where a reply is written and waiting on a decision. This is the
// queue the receptionist actually creates -- without it the drafts it writes
// unprompted are only found by opening threads one at a time, which is the
// work drafting was meant to remove.
const draftReadyCount = computed(() => leadConversations.value.filter((c) => c.hasDraft).length)

// Unread rather than total. The split itself is visible in the list; what
// the front desk is actually asking is "is anyone waiting on me", and
// "Patients · 14" answers that with the fourteen threads nobody has to touch.
const leadUnreadCount = computed(() => leadConversationsInView.value.filter((c) => c.unread).length)
const patientUnreadCount = computed(() => counts.value.unread)

// Resolved against the full list, never the filtered one -- exactly as
// `selected` is for real conversations above. Reading it from
// visibleLeadConversations meant taking a thread off the AI filtered it out
// from under the person who had just opened it: the panel emptied and the
// inbox fell back to "Select a conversation", mid-reply.
const selectedLead = computed(() => {
  if (!hasGrowth.value) return null
  return leadConversations.value.find((c) => c.key === selectedKey.value) ?? null
})

// Leads join the same per-person read status and team assignment as patient
// threads, keyed lead:<id> in inbox_reads and inbox_assignments. Their list
// comes from the Growth endpoint, so both are read here and applied to it.
const leadReads = ref<Record<string, string>>({})
const leadOwners = ref<Record<string, string>>({})
async function loadLeadState() {
  if (!hasGrowth.value || !store.accountId || !myId.value) return
  const [reads, owners] = await Promise.all([
    supabase.from('inbox_reads').select('conversation_key, last_read_at').eq('team_member_id', myId.value).like('conversation_key', 'lead:%'),
    supabase.from('inbox_assignments').select('conversation_key, team_member_id').eq('account_id', store.accountId).like('conversation_key', 'lead:%'),
  ])
  leadReads.value = Object.fromEntries((reads.data ?? []).map((r) => [r.conversation_key, r.last_read_at]))
  leadOwners.value = Object.fromEntries((owners.data ?? []).map((r) => [r.conversation_key, r.team_member_id]))
}
watch([hasGrowth, () => store.teamMember], () => loadLeadState(), { immediate: true })
// The endpoint calls a lead unread whenever they wrote last; read since then
// (by me) it is not.
watch([leadConversations, leadReads], () => {
  for (const c of leadConversations.value) {
    const readAt = leadReads.value[c.key]
    if (c.unread && readAt && readAt >= c.lastMessageAt) c.unread = false
  }
})

function selectLeadConversation(c: { key: string; leadId: string }) {
  draftConversation.value = null
  selectedKey.value = c.key
  const match = leadConversations.value.find((l) => l.key === c.key)
  if (match?.unread) {
    match.unread = false
    leadReads.value = { ...leadReads.value, [c.key]: new Date().toISOString() }
    setReadAt([c.key], new Date().toISOString())
  }
  loadLeadThread(c.leadId)
}

async function onLeadTakeOver() {
  if (!selectedLead.value) return
  await takeOver(selectedLead.value.leadId)
  await loadLeadThread(selectedLead.value.leadId)
}
async function onLeadHandBack() {
  if (!selectedLead.value) return
  await handBack(selectedLead.value.leadId)
  await loadLeadThread(selectedLead.value.leadId)
}
async function onLeadReply(text: string) {
  if (!selectedLead.value) return
  // The list's preview and unread flag come from the same rows the thread
  // does, so both are refreshed rather than patched in two places.
  if (await replyToLead(selectedLead.value.leadId, text)) await reloadLeadConversations()
}

// Today shows a clock, anything older shows a date -- the same shorthand the
// patient rows beside these use.
function leadRowTime(at: string) {
  const when = new Date(at)
  const today = new Date().toDateString() === when.toDateString()
  return when.toLocaleString('en-GB', today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' })
}


// Archived is a view of its own with no leads in it, so "Leads" there would
// blank the list and show nothing in its place. The filter only bites where
// there are two kinds of row to tell apart.
const filteredConversations = computed(() => (sourceFilter.value === 'leads' && hasGrowth.value && view.value !== 'archived' ? [] : conversations.value))

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
// A brand-new conversation started via "New" has no rows yet, so it can't
// come from the list -- it lives here until the first template send lands it
// in the real table. A conversation opened from a push notification that is
// not on the loaded page is fetched on its own into `openedRow`.
const draftConversation = ref<Conversation | null>(null)
const openedRow = ref<InboxRow | null>(null)
const selected = computed<Conversation | null>(() => {
  const inList = conversations.value.find((c) => c.key === selectedKey.value)
  if (inList) return inList
  if (openedRow.value?.conversation_key === selectedKey.value) return toConversation(openedRow.value)
  return draftConversation.value?.key === selectedKey.value ? draftConversation.value : null
})

// The open conversation's own messages, oldest first, with this tab's
// unconfirmed sends at the end.
const threadMessages = ref<Message[]>([])
const threadLoading = ref(false)
const THREAD_COLUMNS = 'id, patient_id, phone_number, external_contact_id, direction, status, body_preview, template_name, media_type, media_storage_path, media_mime_type, media_filename, channel, created_at'
let threadToken = 0
async function loadThread(c: Conversation | null, opts: { silent?: boolean } = {}) {
  const token = ++threadToken
  if (!c) {
    threadMessages.value = []
    return
  }
  if (!opts.silent) threadLoading.value = true
  let wa = supabase.from('whatsapp_messages').select(THREAD_COLUMNS).or('lead_id.is.null,patient_id.not.is.null')
  if (c.patientId) wa = wa.eq('patient_id', c.patientId)
  else if (c.phoneNumber) wa = wa.eq('phone_number', c.phoneNumber).is('patient_id', null)
  else if (c.externalContactId) wa = wa.eq('external_contact_id', c.externalContactId).is('patient_id', null)
  else {
    threadMessages.value = []
    threadLoading.value = false
    return
  }
  const [{ data: waData }, app] = await Promise.all([
    wa.order('created_at', { ascending: false }).limit(300),
    c.patientId
      ? supabase.from('patient_app_messages').select('id, patient_id, direction, body, created_at').eq('patient_id', c.patientId).order('created_at', { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as { id: string; patient_id: string; direction: string; body: string; created_at: string }[] }),
  ])
  if (token !== threadToken) return
  // In-app messages are normalized into the same Message shape so the thread
  // (ticks, media, retry) doesn't need to know two tables exist.
  const appMessages: Message[] = (app.data ?? []).map((m) => ({
    id: m.id,
    patient_id: m.patient_id,
    phone_number: null,
    external_contact_id: null,
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
  threadMessages.value = [...((waData ?? []) as Message[]), ...appMessages].sort((a, b) => a.created_at.localeCompare(b.created_at))
  threadLoading.value = false
}
const thread = computed(() => {
  if (!selectedKey.value) return []
  const pending = pendingMessages.value.filter((m) => keyOf(m) === selectedKey.value)
  return [...threadMessages.value, ...pending]
})
watch(selectedKey, () => loadThread(selected.value))

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


// Read status is each person's own (inbox_reads): opening a conversation
// marks it read for me, not for the rest of the team.
async function setReadAt(keys: string[], at: string) {
  if (!store.accountId || !myId.value || keys.length === 0) return
  const unread = at === new Date(0).toISOString()
  rows.value = rows.value.map((r) => (keys.includes(r.conversation_key) ? { ...r, unread_for_me: unread && r.last_direction === 'inbound' } : r))
  await supabase
    .from('inbox_reads')
    .upsert(keys.map((k) => ({ account_id: store.accountId!, team_member_id: myId.value!, conversation_key: k, last_read_at: at })) as never)
  loadCounts()
  refreshNavBadges()
}
async function markRead(key: string) {
  await setReadAt([key], new Date().toISOString())
}

function selectConversation(c: Conversation) {
  draftConversation.value = null
  selectedKey.value = c.key
  if (c.unread) markRead(c.key)
}

// Clicking a push notification lands here with ?open=<conversation key>. The
// conversation may not be on the first page of the list, so it is fetched on
// its own and opened the same way a click on its row would.
const route = useRoute()
onMounted(async () => {
  const key = route.query.open
  if (typeof key !== 'string') return
  if (key.startsWith('lead:')) {
    // Lead rows arrive from the Growth endpoint, after mount.
    const stop = watch(leadConversations, (list) => {
      const lead = list.find((c) => c.key === key)
      if (lead) {
        stop()
        selectLeadConversation(lead)
      }
    }, { immediate: true })
    return
  }
  const { data } = await supabase.from('inbox_conversations').select('*').eq('conversation_key', key).maybeSingle()
  if (!data) return
  openedRow.value = data as unknown as InboxRow
  selectConversation(toConversation(openedRow.value))
})

// --- Archive, unread, assign (single and bulk) ------------------------------------
async function setArchived(keys: string[], archive: boolean) {
  if (keys.length === 0 || !store.teamMember || !store.accountId) return
  if (archive) {
    await supabase
      .from('whatsapp_conversation_archives')
      .upsert(keys.map((k) => ({ account_id: store.accountId!, team_member_id: store.teamMember!.id, conversation_key: k })) as never)
  } else {
    await supabase.from('whatsapp_conversation_archives').delete().eq('team_member_id', store.teamMember.id).in('conversation_key', keys)
  }
  // It leaves the view it was in, so the list is re-read rather than patched.
  await loadList({ silent: true })
  refreshNavBadges()
}
async function bulkArchiveSelected(archive: boolean) {
  await setArchived([...selectedKeys.value], archive)
  exitSelectionMode()
}
async function bulkMarkUnreadSelected() {
  await setReadAt([...selectedKeys.value], new Date(0).toISOString())
  exitSelectionMode()
}
function toggleArchiveSelected(key: string) {
  const isArchived = !!selected.value?.archived
  setArchived([key], !isArchived)
}

// Who is looking after a conversation. Shared by the whole team, unlike the
// three above; null takes it off whoever had it.
const assignMenuFor = ref<'thread' | 'bulk' | 'lead' | null>(null)
// Below 1280px there is no room for the patient panel beside the thread, so
// it opens over it from the header instead.
const panelOpen = ref(false)
watch(selectedKey, () => (panelOpen.value = false))
async function assign(keys: string[], memberId: string | null) {
  assignMenuFor.value = null
  if (keys.length === 0 || !store.accountId) return
  rows.value = rows.value.map((r) => (keys.includes(r.conversation_key) ? { ...r, assigned_to: memberId } : r))
  const owners = { ...leadOwners.value }
  for (const k of keys.filter((k) => k.startsWith('lead:'))) {
    if (memberId) owners[k] = memberId
    else delete owners[k]
  }
  leadOwners.value = owners
  if (openedRow.value && keys.includes(openedRow.value.conversation_key)) openedRow.value = { ...openedRow.value, assigned_to: memberId }
  if (memberId) {
    await supabase
      .from('inbox_assignments')
      .upsert(keys.map((k) => ({ account_id: store.accountId!, conversation_key: k, team_member_id: memberId, assigned_by: myId.value, assigned_at: new Date().toISOString() })) as never)
  } else {
    await supabase.from('inbox_assignments').delete().eq('account_id', store.accountId).in('conversation_key', keys)
  }
  loadCounts()
  // "Mine" and "Unassigned" are lists of exactly this, so re-read them.
  if (tab.value !== 'all') loadList({ silent: true })
}
function onAssignDocClick(e: MouseEvent) {
  if (assignMenuFor.value && !(e.target as HTMLElement).closest('[data-assign-menu]')) assignMenuFor.value = null
}
onMounted(() => document.addEventListener('click', onAssignDocClick))
onUnmounted(() => document.removeEventListener('click', onAssignDocClick))

// An unknown number linked to a patient (InboxUnknownPanel) becomes that
// patient's thread: the list is re-read and the patient's key opened.
async function onLinked(patientId: string) {
  selectedKey.value = null
  await loadList({ silent: true })
  const { data } = await supabase.from('inbox_conversations').select('*').eq('conversation_key', patientId).maybeSingle()
  if (data) openedRow.value = data as unknown as InboxRow
  selectedKey.value = patientId
}


// Shared by the thread-header LabelPicker (one conversation) and the bulk
// bar's LabelPicker (a whole selection) -- both just need "toggle this
// label for these keys," they differ only in how many keys that is.
function applyLabels(byKey: Record<string, string[]>) {
  rows.value = rows.value.map((r) => (byKey[r.conversation_key] ? { ...r, my_label_ids: byKey[r.conversation_key] } : r))
}
async function toggleLabelForKeys(labelId: string, keys: string[]) {
  if (!store.teamMember || !store.accountId || keys.length === 0) return
  // "Applied to all" toggles off for all; anything less than that (none, or
  // a mixed bulk selection) toggles on for whichever don't have it yet --
  // matches the checkbox convention used elsewhere (e.g. patient tag lists)
  // where a partially-applied state fills in rather than clearing first.
  const allApplied = keys.every((k) => myLabelsByKey.value[k]?.includes(labelId))
  const nextByKey: Record<string, string[]> = { ...myLabelsByKey.value }
  if (allApplied) {
    for (const k of keys) nextByKey[k] = (nextByKey[k] ?? []).filter((id) => id !== labelId)
    applyLabels(nextByKey)
    await supabase.from('whatsapp_conversation_labels').delete().eq('team_member_id', store.teamMember.id).eq('label_id', labelId).in('conversation_key', keys)
  } else {
    const toAdd = keys.filter((k) => !myLabelsByKey.value[k]?.includes(labelId))
    for (const k of toAdd) nextByKey[k] = [...(nextByKey[k] ?? []), labelId]
    applyLabels(nextByKey)
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
  // Whichever channel the reply goes out on -- not always WhatsApp. An
  // Instagram thread's inbound messages carry channel 'instagram', so looking
  // only at WhatsApp ones found nothing and every Instagram conversation read
  // as "more than 24 hours since they last wrote", however recent it was. The
  // composer was shut before the first DM had finished arriving.
  const lastInbound = thread.value.filter((m) => m.direction === 'inbound' && m.channel === replyChannel.value).at(-1)
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
    } else if (channel === 'instagram') {
      // Its own route: a recipient here is an IGSID, not a phone number, so
      // whatsapp/inbox-send has nothing to send to. Everything that was not
      // in-app used to go there, which meant /api/instagram/send existed and
      // shipped and was never once called -- an Instagram reply was posted to
      // WhatsApp with no number and failed.
      if (!target.externalContactId) throw new Error('This Instagram conversation has no sender id')
      await useStaffFetch('/api/instagram/send', { method: 'POST', body: { recipientId: target.externalContactId, text } })
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
    await Promise.all([loadThread(target, { silent: true }), loadList({ silent: true })])
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
      external_contact_id: target.externalContactId ?? null,
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
    await Promise.all([loadThread(target, { silent: true }), loadList({ silent: true })])
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
      external_contact_id: target.externalContactId ?? null,
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

async function onTemplateSent() {
  templateModalOpen.value = false
  const key = selectedKey.value
  draftConversation.value = null
  await loadList({ silent: true })
  if (key && !rows.value.some((r) => r.conversation_key === key)) {
    const { data } = await supabase.from('inbox_conversations').select('*').eq('conversation_key', key).maybeSingle()
    if (data) openedRow.value = data as unknown as InboxRow
  }
  loadThread(selected.value, { silent: true })
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


// Live updates: new inbound/outbound messages land without a manual refresh,
// silently -- re-showing the skeleton on each one was a layout jump. Only the
// list's head and the open thread are re-read, not every message.
let refreshTimer: ReturnType<typeof setTimeout> | undefined
function refreshSoon() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    loadList({ silent: true })
    if (selected.value) loadThread(selected.value, { silent: true })
    refreshNavBadges()
  }, 400)
}
let channel: ReturnType<typeof supabase.channel> | null = null
onMounted(() => {
  channel = supabase
    .channel('inbox-whatsapp-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, refreshSoon)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${store.accountId}` }, refreshSoon)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `account_id=eq.${store.accountId}` }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_assignments', filter: `account_id=eq.${store.accountId}` }, refreshSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_labels', filter: `account_id=eq.${store.accountId}` }, () => loadLabels())
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})

// Belt-and-suspenders alongside the realtime subscription -- a websocket that
// silently drops (backgrounded tab, network blip) would otherwise leave the
// inbox stale. A minute is enough now that each refresh reads the list's
// head rather than 2,000 messages.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => refreshSoon(), 60000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const listEl = ref<HTMLElement | null>(null)
const { pulling, refreshing: pullRefreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(listEl, () => loadList({ silent: true }))

function avatarInitials(name: string) {
  const parts = name.replace(/^\+/, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (/^\d/.test(parts[0])) return '#'
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Inbox', 'Bandeja de entrada')" />
    <div v-if="webPush.supported.value && webPush.permission.value === 'default' && !pushBannerDismissed" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-tint px-4 py-2">
      <p class="text-[12.5px] text-brand-text">{{ t('Get notified here when a patient messages you, even with the tab in the background.', 'Recibe avisos aquí cuando un paciente te escriba, incluso con la pestaña en segundo plano.') }}</p>
      <div class="flex shrink-0 items-center gap-3">
        <UiBtn variant="primary" size="sm" @click="webPush.register()">{{ t('Enable notifications', 'Activar notificaciones') }}</UiBtn>
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="pushBannerDismissed = true">{{ t('Not now', 'Ahora no') }}</button>
      </div>
    </div>
    <div class="flex flex-1 overflow-hidden">
      <!-- Conversation list. Full-width on mobile (there's no room for a
      list alongside a thread), swapped for the thread panel once a
      conversation is selected instead of splitting the screen between them. -->
      <div
        class="w-full flex-col border-r border-line bg-surface md:flex md:w-[340px] md:shrink-0 xl:w-[320px] 2xl:w-[380px]"
        :class="selected || selectedLead ? 'hidden md:flex' : 'flex'"
        data-cy="inbox-list"
        :data-ready="ready ? 'true' : undefined"
      >
        <div class="flex flex-col gap-2.5 border-b border-line-divider p-3">
          <template v-if="!selectionMode">
            <div class="flex items-center gap-2">
              <label class="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 text-ink-muted focus-within:border-brand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input
                  v-model="search"
                  type="search"
                  data-cy="inbox-search"
                  :aria-label="t('Search conversations', 'Buscar conversaciones')"
                  :placeholder="t('Search name, number, messages…', 'Buscar nombre, número, mensajes…')"
                  class="min-w-0 flex-1 bg-transparent text-[14px] text-ink-900 placeholder:text-ink-faint focus:outline-none"
                />
              </label>
              <button
                type="button"
                data-cy="inbox-select"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted hover:bg-surface-subtle"
                :aria-label="t('Select several', 'Seleccionar varias')"
                :title="t('Select several', 'Seleccionar varias')"
                @click="selectionMode = true"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 12.5l3 3 5-6" /></svg>
              </button>
              <button
                type="button"
                data-cy="inbox-archived-toggle"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border"
                :class="view === 'archived' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
                :aria-pressed="view === 'archived'"
                :aria-label="view === 'archived' ? t('Show active conversations', 'Mostrar conversaciones activas') : t('Show my archived conversations', 'Mostrar mis archivadas')"
                :title="view === 'archived' ? t('Show active conversations', 'Mostrar conversaciones activas') : t('Show my archived conversations', 'Mostrar mis archivadas')"
                @click="view = view === 'archived' ? 'active' : 'archived'"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v4H3z" /><path d="M5 9v10h14V9" /><path d="M10 13h4" /></svg>
              </button>
              <div v-if="view === 'active'" ref="composeEl" class="relative shrink-0">
                <button type="button" data-cy="inbox-new" class="h-11 rounded-ctl bg-brand px-3.5 text-[14px] font-bold text-surface hover:bg-brand-hover" @click="composeOpen = !composeOpen">
                  {{ t('New', 'Nueva') }}
                </button>
                <div v-if="composeOpen" class="absolute right-0 top-[calc(100%+4px)] z-20 w-72 rounded-card border border-line bg-surface p-2 shadow-popover">
                  <input
                    v-model="composeQuery"
                    type="text"
                    autofocus
                    :placeholder="t('Search patients…', 'Buscar pacientes…')"
                    class="h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
                  />
                  <ul class="mt-1 max-h-64 overflow-y-auto">
                    <li v-for="p in filteredComposePatients" :key="p.id">
                      <button type="button" class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-700 hover:bg-surface-subtle" @click="startConversationWith(p)">
                        {{ p.first_name }} {{ p.last_name ?? '' }}
                      </button>
                    </li>
                    <li v-if="filteredComposePatients.length === 0" class="px-2.5 py-2 text-[13px] text-ink-faint">{{ t('No matches', 'Sin coincidencias') }}</li>
                  </ul>
                </div>
              </div>
            </div>
            <div v-if="view === 'active'" role="tablist" :aria-label="t('Whose', 'De quién')" class="flex rounded-ctl bg-chip-bg p-[3px]">
              <button
                v-for="tb in [
                  { key: 'all', label: t('All', 'Todas'), count: tabCounts.all },
                  { key: 'mine', label: t('Mine', 'Mías'), count: tabCounts.mine },
                  { key: 'unassigned', label: t('Unassigned', 'Sin asignar'), count: tabCounts.unassigned },
                ]"
                :key="tb.key"
                type="button"
                role="tab"
                :data-cy="`inbox-tab-${tb.key}`"
                :aria-selected="tab === tb.key"
                class="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[13.5px] font-semibold"
                :class="tab === tb.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'"
                @click="tab = tb.key as 'all' | 'mine' | 'unassigned'"
              >
                {{ tb.label }} <span class="text-[12.5px] font-medium text-ink-muted">{{ tb.count }}</span>
              </button>
            </div>
            <!-- One row that scrolls sideways: wrapped, the filters took four
            rows of a laptop screen before the first conversation. -->
            <div class="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 [&>*]:shrink-0">
              <!-- First in the row, and only where both kinds exist. This is
              the split people are actually scanning for; every chip after it
              narrows within whichever side is showing. -->
              <template v-if="hasGrowth && view !== 'archived'">
                <button
                  type="button"
                  class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                  :class="sourceFilter === 'patients' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  data-test="filter-patients-only"
                  @click="sourceFilter = sourceFilter === 'patients' ? 'all' : 'patients'"
                >
                  {{ t('Patients', 'Pacientes') }}<span v-if="patientUnreadCount > 0"> · {{ patientUnreadCount }}</span>
                </button>
                <button
                  type="button"
                  class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                  :class="sourceFilter === 'leads' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  data-test="filter-leads-only"
                  @click="sourceFilter = sourceFilter === 'leads' ? 'all' : 'leads'"
                >
                  {{ t('Leads', 'Leads') }}<span v-if="leadUnreadCount > 0"> · {{ leadUnreadCount }}</span>
                </button>
              </template>
              <button
                type="button"
                data-cy="inbox-filter-unread"
                :aria-pressed="unreadOnly"
                class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                :class="unreadOnly ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                @click="unreadOnly = !unreadOnly"
              >
                {{ t('Unread', 'No leídas') }}<span v-if="counts.unread > 0"> · {{ counts.unread }}</span>
              </button>
              <button
                type="button"
                :aria-pressed="replyFilter === 'awaiting_us'"
                class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                :class="replyFilter === 'awaiting_us' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                @click="replyFilter = replyFilter === 'awaiting_us' ? 'all' : 'awaiting_us'"
              >
                {{ t('Awaiting us', 'Esperan respuesta') }}
              </button>
              <button
                type="button"
                :aria-pressed="replyFilter === 'awaiting_patient'"
                class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                :class="replyFilter === 'awaiting_patient' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                @click="replyFilter = replyFilter === 'awaiting_patient' ? 'all' : 'awaiting_patient'"
              >
                {{ t('Awaiting patient', 'Esperan al paciente') }}
              </button>
              <InboxLabelFilterPicker v-model="labelFilter" :labels="labels" />
              <!-- Growth only. Without the tier there are no AI-handled
              conversations, so these would filter a list of nothing. -->
              <template v-if="hasGrowth">
                <button
                  type="button"
                  class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                  :class="aiFilter === 'ai_handling' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  data-test="filter-ai-handling"
                  @click="aiFilter = aiFilter === 'ai_handling' ? 'all' : 'ai_handling'"
                >
                  {{ t('AI handling', 'IA gestionando') }} · {{ aiHandlingCount }}
                </button>
                <button
                  type="button"
                  class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                  :class="aiFilter === 'needs_human' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  data-test="filter-needs-human"
                  @click="aiFilter = aiFilter === 'needs_human' ? 'all' : 'needs_human'"
                >
                  {{ t('Needs human', 'Requiere persona') }} · {{ needsHumanCount }}
                </button>
                <!-- Only when there is one. A chip reading "· 0" every day
                     teaches people to stop looking at it, and this is the one
                     that means somebody has work waiting. -->
                <button
                  v-if="draftReadyCount > 0"
                  type="button"
                  class="flex h-10 items-center gap-1 rounded-pill border px-3 text-[13px] font-semibold"
                  :class="aiFilter === 'draft_ready' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  data-test="filter-draft-ready"
                  @click="aiFilter = aiFilter === 'draft_ready' ? 'all' : 'draft_ready'"
                >
                  {{ t('Draft ready', 'Borrador listo') }} · {{ draftReadyCount }}
                </button>
              </template>
            </div>
          </template>
          <div v-else role="region" :aria-label="t('Selection', 'Selección')" class="flex flex-col gap-2 rounded-card border border-brand-tintBorder bg-brand-tint p-2.5" data-cy="inbox-bulk">
            <div class="flex items-center gap-2">
              <strong class="flex-1 text-[14px] text-brand-text">{{ t(`${selectedKeys.size} selected`, `${selectedKeys.size} seleccionadas`) }}</strong>
              <button type="button" class="h-9 rounded-ctlSm px-2.5 text-[13.5px] font-semibold text-ink-500 hover:text-ink-700" @click="exitSelectionMode">{{ t('Cancel', 'Cancelar') }}</button>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <div class="relative" data-assign-menu>
                <button
                  type="button"
                  data-cy="inbox-bulk-assign"
                  class="h-10 rounded-ctl bg-brand px-3 text-[13.5px] font-bold text-surface disabled:opacity-50"
                  :disabled="selectedKeys.size === 0"
                  @click.stop="assignMenuFor = assignMenuFor === 'bulk' ? null : 'bulk'"
                >
                  {{ t('Assign to…', 'Asignar a…') }}
                </button>
                <div v-if="assignMenuFor === 'bulk'" role="menu" class="absolute left-0 top-[calc(100%+4px)] z-20 w-64 rounded-card border border-line bg-surface p-1.5 shadow-popover">
                  <button v-for="m in team" :key="m.id" type="button" role="menuitem" class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="assign([...selectedKeys], m.id); exitSelectionMode()">
                    {{ m.id === myId ? t(`${m.full_name} (you)`, `${m.full_name} (tú)`) : m.full_name }}
                  </button>
                  <button type="button" role="menuitem" class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-500 hover:bg-surface-subtle" @click="assign([...selectedKeys], null); exitSelectionMode()">
                    {{ t('Unassigned', 'Sin asignar') }}
                  </button>
                </div>
              </div>
              <InboxLabelPicker
                :labels="labels"
                :applied-ids="[]"
                @toggle-label="(id: string) => toggleLabelForKeys(id, [...selectedKeys])"
                @create-label="(name: string, color: string) => createLabel(name, color, [...selectedKeys])"
              />
              <button type="button" data-cy="inbox-bulk-unread" class="h-10 rounded-ctl border border-brand-tintBorder bg-surface px-3 text-[13.5px] font-semibold text-brand-text disabled:opacity-50" :disabled="selectedKeys.size === 0" @click="bulkMarkUnreadSelected">
                {{ t('Mark unread', 'Marcar no leídas') }}
              </button>
              <button type="button" data-cy="inbox-bulk-archive" class="h-10 rounded-ctl border border-brand-tintBorder bg-surface px-3 text-[13.5px] font-semibold text-brand-text disabled:opacity-50" :disabled="selectedKeys.size === 0" @click="bulkArchiveSelected(view !== 'archived')">
                {{ view === 'archived' ? t('Unarchive', 'Desarchivar') : t('Archive', 'Archivar') }}
              </button>
            </div>
            <span class="text-[12.5px] text-ink-500">{{ t('Archive, labels and read status are yours alone. Assigning is seen by the whole team.', 'Archivar, etiquetas y leídas son solo tuyas. Asignar lo ve todo el equipo.') }}</span>
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
            :style="{ height: pullRefreshing ? '40px' : `${pullDistance}px` }"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4 text-brand" :class="{ 'animate-spin': pullRefreshing }" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M4 12a8 8 0 0 1 14.5-4.6M20 12a8 8 0 0 1-14.5 4.6" />
              <path d="M17.5 3v5h-5M6.5 21v-5h5" />
            </svg>
          </div>
          <div v-if="loading">
            <div v-for="i in 5" :key="i" class="flex items-center gap-3 border-b border-line-row px-3.5 py-3">
              <UiSkeleton class="h-10 w-10 shrink-0 rounded-full" />
              <div class="min-w-0 flex-1 space-y-1.5">
                <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
                <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
              </div>
            </div>
          </div>
          <p v-else-if="filteredConversations.length === 0 && visibleLeadConversations.length === 0" class="p-6 text-center text-[14px] text-ink-faint" data-cy="inbox-empty">
            <template v-if="view === 'archived'">{{ t('No archived conversations.', 'No hay conversaciones archivadas.') }}</template>
            <template v-else-if="search.trim() || tab !== 'all' || unreadOnly || replyFilter !== 'all' || labelFilter">{{ t('Nothing matches these filters.', 'Nada coincide con estos filtros.') }}</template>
            <template v-else>{{ t('No conversations yet.', 'Aún no hay conversaciones.') }}</template>
          </p>
          <!-- Lead conversations sit at the top of the same list, not in a
          section of their own: one person, one thread is the whole argument
          for merging these inboxes rather than shipping a second one. -->
          <button
            v-for="c in visibleLeadConversations"
            :key="c.key"
            type="button"
            class="flex min-h-[76px] w-full items-start gap-3 border-b border-l-[3px] border-b-line-row px-3.5 py-3 text-left hover:bg-surface-subtle"
            :class="selectedKey === c.key && !selectionMode ? 'border-l-brand bg-brand-tint' : 'border-l-transparent'"
            data-test="lead-row"
            @click="selectLeadConversation(c)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-bold text-brand-text">
              {{ c.initials }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate text-[15px] text-ink-900" :class="c.unread ? 'font-bold' : 'font-medium'">{{ c.name }}</span>
                <span class="shrink-0 text-[12.5px] text-ink-muted">{{ leadRowTime(c.lastMessageAt) }}</span>
              </div>
              <p class="truncate text-[13.5px]" :class="c.unread ? 'text-ink-900' : 'text-ink-500'">
                <!-- Said before the message, not after: the row is truncated,
                and a marker at the end is the part that gets cut off. -->
                <span v-if="c.previewWasNotSent" class="font-medium text-warning-text">{{ t('Not sent ·', 'No enviado ·') }} </span>{{ c.preview }}
              </p>
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <!-- Leftmost, because the row truncates from the right and
                this is the one badge that says what kind of row it is. The
                channel beside it is "how they wrote in"; this is "who". -->
                <span class="rounded-pill border border-info-border bg-info-bg px-2 py-px text-[11.5px] font-bold text-info-text" data-test="lead-badge">{{ t('Lead', 'Lead') }}</span>
                <span class="rounded-pill border border-chip-border bg-chip-bg px-2 py-px text-[11.5px] text-ink-muted">{{ CHANNEL_LABEL[c.channel] }}</span>
                <span v-if="c.hasDraft" class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2 py-px text-[11.5px] font-bold text-brand-text" data-test="draft-ready-badge">{{ t('Draft ready', 'Borrador listo') }}</span>
                <span v-if="c.aiState === 'handling'" class="rounded-pill bg-brand px-2 py-px text-[11.5px] font-bold text-surface">{{ t('AI handling', 'IA gestionando') }}</span>
                <span v-else-if="c.aiState === 'paused'" class="rounded-pill border border-chip-border bg-chip-bg px-2 py-px text-[11.5px] text-ink-muted">{{ t('AI paused', 'IA en pausa') }}</span>
                <span v-else-if="c.aiState === 'needs_human'" class="rounded-pill border border-warning-border bg-warning-bg px-2 py-px text-[11.5px] font-medium text-warning-text">{{ t('Needs human', 'Requiere persona') }}</span>
                <span v-else-if="c.aiState === 'blocked'" class="rounded-pill border border-danger-border bg-danger-bg px-2 py-px text-[11.5px] font-medium text-danger-text">{{ t('Blocked', 'Bloqueado') }}</span>
                <span class="flex-1" />
                <span
                  v-if="leadOwners[c.key]"
                  class="flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-chip-border bg-chip-bg px-1 text-[10px] font-bold text-ink-700"
                  :title="t(`Assigned to ${memberName(leadOwners[c.key])}`, `Asignada a ${memberName(leadOwners[c.key])}`)"
                  data-cy="lead-row-owner"
                >{{ memberInitials(leadOwners[c.key]) }}</span>
              </div>
            </div>
          </button>
          <button
            v-for="c in filteredConversations"
            :key="c.key"
            type="button"
            data-cy="inbox-row"
            :data-key="c.key"
            :aria-current="selectedKey === c.key && !selectionMode ? 'true' : undefined"
            class="flex min-h-[76px] w-full items-start gap-3 border-b border-l-[3px] border-b-line-row px-3.5 py-3 text-left hover:bg-surface-subtle"
            :class="(selectedKey === c.key && !selectionMode) || selectedKeys.has(c.key) ? 'border-l-brand bg-brand-tint' : 'border-l-transparent'"
            @click="onRowClick(c)"
          >
            <span
              v-if="selectionMode"
              class="mt-2.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border"
              :class="selectedKeys.has(c.key) ? 'border-brand bg-brand text-surface' : 'border-line-control bg-surface'"
              aria-hidden="true"
            >
              <svg v-if="selectedKeys.has(c.key)" viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 8l3.5 3.5L13 5" />
              </svg>
            </span>
            <span class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" :class="c.patientId ? 'bg-brand-tint text-brand-text' : 'bg-chip-bg text-ink-700'">
              {{ avatarInitials(c.name) }}
              <span
                class="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface px-1 text-[9px] font-extrabold"
                :class="c.channel === 'whatsapp' ? 'bg-success-bg text-success-text' : c.channel === 'instagram' ? 'bg-info-bg text-info-text' : 'bg-brand-tint text-brand-text'"
                :title="channelName(c.channel)"
              >{{ c.channel === 'whatsapp' ? 'WA' : c.channel === 'instagram' ? 'IG' : 'App' }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <p class="truncate text-[15px]" :class="c.unread ? 'font-bold text-ink-900' : 'font-medium text-ink-800'">{{ c.name }}</p>
                <span class="shrink-0 text-[12.5px] text-ink-muted">{{ listTime(c.lastMessage!.created_at) }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <p class="min-w-0 flex-1 truncate text-[13.5px]" :class="c.unread ? 'text-ink-900' : 'text-ink-500'">
                  {{ c.lastMessage!.direction === 'outbound' ? t('You: ', 'Tú: ') : '' }}{{ previewText(c.lastMessage!) }}
                </p>
                <span v-if="c.unread" class="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" :aria-label="t('Unread', 'No leída')" data-cy="inbox-row-unread" />
              </div>
              <div v-if="c.labelIds?.length || c.assignedTo" class="mt-1 flex flex-wrap items-center gap-1">
                <span
                  v-for="lid in c.labelIds"
                  :key="lid"
                  class="rounded-pill px-2 py-px text-[11.5px] font-semibold text-surface"
                  :style="{ backgroundColor: labels.find((l) => l.id === lid)?.color }"
                >
                  {{ labels.find((l) => l.id === lid)?.name }}
                </span>
                <span class="flex-1" />
                <span
                  v-if="c.assignedTo"
                  class="flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-chip-border bg-chip-bg px-1 text-[10px] font-bold text-ink-700"
                  :title="t(`Assigned to ${memberName(c.assignedTo)}`, `Asignada a ${memberName(c.assignedTo)}`)"
                  data-cy="inbox-row-owner"
                >{{ memberInitials(c.assignedTo) }}</span>
              </div>
            </div>
          </button>
          <div v-if="hasMore && !loading" class="p-3">
            <button type="button" data-cy="inbox-load-more" class="h-11 w-full rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-60" :disabled="loadingMore" @click="loadList({ append: true })">
              {{ loadingMore ? t('Loading…', 'Cargando…') : t('Load older conversations', 'Cargar conversaciones anteriores') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Thread -->
      <div v-if="!selected && !selectedLead" class="hidden flex-1 items-center justify-center text-[13px] text-ink-faint md:flex">
        {{ t('Select a conversation to view messages.', 'Selecciona una conversación para ver los mensajes.') }}
      </div>
      <!-- A lead thread renders its own panel and rail. It shares nothing
      with the block below on purpose: that one sends through the WhatsApp
      API against a real patient row, and a lead has neither. -->
      <template v-else-if="selectedLead">
        <div class="flex min-w-0 flex-1 flex-col">
        <!-- Leads are assigned like any other conversation. -->
        <div class="flex shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-3 py-2" data-assign-menu>
          <span class="text-[13px] text-ink-muted">{{ t('Assigned to', 'Asignada a') }}</span>
          <div class="relative">
            <button
              type="button"
              data-cy="lead-assign"
              aria-haspopup="menu"
              :aria-expanded="assignMenuFor === 'lead'"
              class="flex h-11 items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle"
              @click.stop="assignMenuFor = assignMenuFor === 'lead' ? null : 'lead'"
            >
              {{ leadOwners[selectedLead.key] ? memberName(leadOwners[selectedLead.key]) : t('Nobody', 'Nadie') }}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div v-if="assignMenuFor === 'lead'" role="menu" class="absolute right-0 top-[calc(100%+4px)] z-20 w-64 rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="lead-assign-menu">
              <button v-for="m in team" :key="m.id" type="button" role="menuitemradio" :aria-checked="leadOwners[selectedLead.key] === m.id" class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle" @click="assign([selectedLead!.key], m.id)">
                {{ m.id === myId ? t(`${m.full_name} (you)`, `${m.full_name} (tú)`) : m.full_name }}
              </button>
              <button type="button" role="menuitemradio" :aria-checked="!leadOwners[selectedLead.key]" class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-500 hover:bg-surface-subtle" @click="assign([selectedLead!.key], null)">
                {{ t('Unassigned', 'Sin asignar') }}
              </button>
            </div>
          </div>
        </div>
        <GrowthInboxLeadThread
          v-if="leadThread"
          :thread="leadThread"
          :sending="leadSending"
          :drafting="leadDrafting"
          @back="selectedKey = null; closeLeadThread()"
          @take-over="onLeadTakeOver"
          @hand-back="onLeadHandBack"
          @send="onLeadReply"
          @draft-reply="leadThread && draftLeadReply(leadThread.id)"
          @approve-draft="(text) => leadThread && approveLeadDraft(leadThread.id, text)"
          @discard-draft="leadThread && discardLeadDraft(leadThread.id)"
        />
        <div v-else class="flex min-w-0 flex-1 flex-col gap-3 bg-surface-page p-4" data-test="lead-thread-loading">
          <UiSkeleton class="h-10 w-56 rounded-ctl" />
          <UiSkeleton class="h-16 w-3/4 rounded-card" />
          <UiSkeleton class="ml-auto h-16 w-2/3 rounded-card" />
        </div>
        </div>
        <GrowthInboxLeadRail v-if="leadThread" :thread="leadThread" />
      </template>
      <!-- v-else-if rather than v-else so the compiler can still narrow
      `selected` to non-null through the branch, which the whole block below
      depends on. -->
      <div v-else-if="selected" class="flex min-w-0 flex-1 flex-col bg-surface-page">
        <div class="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle md:hidden"
            :aria-label="t('Back to conversations', 'Volver a conversaciones')"
            @click="selectedKey = null"
          >
            <svg width="8" height="13" viewBox="0 0 8 13" fill="none" aria-hidden="true"><path d="M7 1L1 6.5L7 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" :class="selected.patientId ? 'bg-brand-tint text-brand-text' : 'bg-chip-bg text-ink-700'">
            {{ avatarInitials(selected.name) }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[16px] font-bold text-ink-900" data-cy="thread-name">{{ selected.name }}</p>
            <p class="flex items-center gap-1.5 truncate text-[13px] text-ink-muted">
              <!-- Named from the channel itself: anything that was not
              WhatsApp used to be labelled "In-app", Instagram included. -->
              <span
                class="rounded-pill px-2 py-px text-[12px] font-bold"
                :class="replyChannel === 'whatsapp' ? 'bg-success-bg text-success-text' : replyChannel === 'instagram' ? 'bg-info-bg text-info-text' : 'bg-brand-tint text-brand-text'"
                data-cy="thread-channel"
              >{{ channelName(replyChannel) }}</span>
              <span v-if="selected.phoneNumber">{{ selected.phoneNumber }}</span>
              <span v-else-if="!selected.patientId && replyChannel !== 'instagram'">{{ t('No patient linked', 'Sin paciente vinculado') }}</span>
            </p>
          </div>
          <button
            v-if="selected.patientId || selected.phoneNumber"
            type="button"
            data-cy="thread-open-panel"
            class="flex h-11 shrink-0 items-center rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] font-semibold text-brand-text hover:bg-surface-subtle xl:hidden"
            @click="panelOpen = true"
          >
            {{ selected.patientId ? t('Patient', 'Ficha') : t('Link', 'Vincular') }}
          </button>
          <div v-if="!isNewConversation" class="relative shrink-0" data-assign-menu>
            <button
              type="button"
              data-cy="thread-assign"
              aria-haspopup="menu"
              :aria-expanded="assignMenuFor === 'thread'"
              class="flex h-11 items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle"
              @click.stop="assignMenuFor = assignMenuFor === 'thread' ? null : 'thread'"
            >
              <span class="flex h-6 min-w-6 items-center justify-center rounded-full bg-chip-bg px-1 text-[10px] font-bold text-ink-700">{{ selected.assignedTo ? memberInitials(selected.assignedTo) : '—' }}</span>
              <span class="hidden 2xl:inline">{{ selected.assignedTo ? (selected.assignedTo === myId ? t('Assigned to you', 'Asignada a ti') : memberName(selected.assignedTo)) : t('Unassigned', 'Sin asignar') }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div v-if="assignMenuFor === 'thread'" role="menu" :aria-label="t('Assign to', 'Asignar a')" class="absolute right-0 top-[calc(100%+4px)] z-20 w-72 rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="thread-assign-menu">
              <button
                v-for="m in team"
                :key="m.id"
                type="button"
                role="menuitemradio"
                :aria-checked="selected.assignedTo === m.id"
                class="flex min-h-11 w-full items-center gap-2.5 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900"
                :class="selected.assignedTo === m.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
                @click="assign([selected!.key], m.id)"
              >
                {{ m.id === myId ? t(`${m.full_name} (you)`, `${m.full_name} (tú)`) : m.full_name }}
              </button>
              <button
                type="button"
                role="menuitemradio"
                :aria-checked="!selected.assignedTo"
                class="flex min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[14px] text-ink-500"
                :class="!selected.assignedTo ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
                @click="assign([selected!.key], null)"
              >
                {{ t('Unassigned', 'Sin asignar') }}
              </button>
              <p class="mt-1 border-t border-line-row px-2.5 pb-1 pt-2 text-[12.5px] leading-snug text-ink-muted">
                {{ t('The whole team sees who it is assigned to. If the patient writes again it stays with the same person.', 'Todo el equipo ve a quién está asignada. Si el paciente vuelve a escribir, sigue con la misma persona.') }}
              </p>
            </div>
          </div>
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
            data-cy="thread-archive"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-500 hover:bg-surface-subtle"
            :aria-label="selected.archived ? t('Unarchive (just for you)', 'Desarchivar (solo para ti)') : t('Archive (just for you)', 'Archivar (solo para ti)')"
            :title="selected.archived ? t('Unarchive (just for you)', 'Desarchivar (solo para ti)') : t('Archive (just for you)', 'Archivar (solo para ti)')"
            @click="toggleArchiveSelected(selected!.key)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v4H3z" /><path d="M5 9v10h14V9" /><path d="M10 13h4" /></svg>
          </button>
          <button
            v-if="!isNewConversation"
            type="button"
            data-cy="thread-mark-unread"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-500 hover:bg-surface-subtle"
            :aria-label="t('Mark as unread (just for you)', 'Marcar como no leída (solo para ti)')"
            :title="t('Mark as unread (just for you)', 'Marcar como no leída (solo para ti)')"
            @click="setReadAt([selected!.key], new Date(0).toISOString()); selectedKey = null"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h8M4 18h11" /><circle cx="19" cy="7" r="3" fill="currentColor" /></svg>
          </button>
        </div>

        <div class="relative min-h-0 flex-1">
          <div ref="threadScrollEl" class="h-full space-y-3 overflow-y-auto px-4 py-4" @scroll="onThreadScroll">
          <template v-for="(m, i) in thread" :key="m.id">
            <div
              v-if="i === 0 || relativeDay(m.created_at) !== relativeDay(thread[i - 1].created_at)"
              class="sticky top-0 z-10 -mx-4 flex justify-center py-1.5"
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
              <!-- Instagram has no template escape hatch: outside the window
              there is nothing to send, only a wait. Saying "send a template
              instead" and showing the button sends staff looking for one that
              cannot exist. -->
              <template v-else-if="replyChannel === 'instagram'">{{ t('More than 24h since', 'Han pasado más de 24h desde que') }} {{ selected.name }} {{ t('last messaged — Instagram blocks replies until they write again.', 'escribió por última vez — Instagram bloquea las respuestas hasta que vuelva a escribir.') }}</template>
              <template v-else>{{ t('More than 24h since', 'Han pasado más de 24h desde que') }} {{ selected.name }} {{ t('last messaged — free-form replies are blocked by WhatsApp. Send a template instead.', 'escribió por última vez — WhatsApp bloquea las respuestas libres. Envía una plantilla en su lugar.') }}</template>
            </p>
            <UiBtn v-if="(selected.patientId || selected.phoneNumber) && replyChannel !== 'instagram'" variant="primary" size="sm" @click="templateModalOpen = true">{{ t('Send template', 'Enviar plantilla') }}</UiBtn>
          </div>
          <div v-else-if="audioRecording" class="flex items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2">
            <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
            <span class="flex-1 text-[13.5px] text-ink-700">{{ t('Recording…', 'Grabando…') }} {{ recordingLabel(audioSeconds) }}</span>
            <button type="button" class="shrink-0 text-[12.5px] text-ink-faint hover:text-ink-muted" @click="cancelAudioRecording">{{ t('Cancel', 'Cancelar') }}</button>
            <UiBtn variant="primary" size="sm" @click="toggleAudioRecording">{{ t('Send', 'Enviar') }}</UiBtn>
          </div>
          <div v-else class="flex items-end gap-2">
            <!-- Attachments and voice notes are WhatsApp-only: both upload
            through whatsapp/inbox-send, and instagram/send posts text alone.
            Offering the buttons on an Instagram thread would take a file,
            upload it and fail at the very end. -->
            <button v-if="replyChannel !== 'instagram'" type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle" :disabled="sending" :aria-label="t('Attach a file', 'Adjuntar archivo')" @click="fileInput?.click()">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                <path d="M11.5 5.5L6.4 10.6a2 2 0 002.8 2.8l5.1-5.1a3.5 3.5 0 00-4.95-4.95L4.25 8.45a5 5 0 007.07 7.07" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <input ref="fileInput" type="file" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" @change="onFileChosen" />
            <button
              v-if="replyChannel !== 'instagram'"
              type="button"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle disabled:opacity-50"
              :disabled="sending"
              :title="t('Record a voice note', 'Grabar una nota de voz')"
              :aria-label="t('Record a voice note', 'Grabar una nota de voz')"
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
              class="max-h-32 min-h-11 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-[10px] text-[15px] text-ink-900 focus:border-brand focus:outline-none"
              @keydown.enter.exact.prevent="sendText"
            />
            <button type="button" data-cy="thread-send" class="h-11 shrink-0 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover disabled:opacity-50" :disabled="sending || !composerText.trim()" @click="sendText">{{ sending ? '…' : t('Send', 'Enviar') }}</button>
          </div>
        </div>
      </div>
      <!-- Beside the thread on a wide screen: who this is, without leaving
      the Inbox -- the patient's next visit, balance and recall, or, for a
      number no patient has, a way to attach it to one. -->
      <div v-if="panelOpen" class="fixed inset-0 z-30 bg-ink-900/40 xl:hidden" data-cy="panel-backdrop" @click="panelOpen = false" />
      <InboxPatientPanel
        v-if="selected?.patientId && !selectedLead"
        :key="selected.patientId"
        :patient-id="selected.patientId"
        :class="panelOpen ? 'fixed inset-y-0 right-0 z-40 flex max-w-[90vw] shadow-drawer xl:static xl:z-auto xl:shadow-none' : 'hidden xl:flex'"
      />
      <InboxUnknownPanel
        v-else-if="selected && !selected.patientId && selected.phoneNumber && !selectedLead"
        :key="selected.phoneNumber"
        :phone-number="selected.phoneNumber"
        :class="panelOpen ? 'fixed inset-y-0 right-0 z-40 flex max-w-[90vw] shadow-drawer xl:static xl:z-auto xl:shadow-none' : 'hidden xl:flex'"
        @linked="(id: string) => { panelOpen = false; onLinked(id) }"
      />
    </div>

    <SendWhatsAppModal
      v-if="templateModalOpen && (selected?.patientId || selected?.phoneNumber)"
      :patient-id="selected.patientId ?? undefined"
      :phone-number="selected.patientId ? undefined : (selected.phoneNumber ?? undefined)"
      :patient-first-name="selected.patientId ? selected.name.split(' ')[0] : undefined"
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
