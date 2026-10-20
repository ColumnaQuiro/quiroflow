import { openAlerts, threadOf, unreadByThread, type TeamMessageRow, type ThreadKey } from '../utils/teamMessages'

// Team messages and alerts (20261020074859_team_messages.sql), shared by the
// Team page, the sidebar's unread count and the alert banner in the layout.
//
// One subscription for the whole app, started by the layout: an alert has
// to reach whatever screen a colleague is on, not only someone who happens
// to have the Team page open. RLS decides what arrives -- realtime applies
// the select policy -- so a direct message between two colleagues never
// reaches a third.
//
// The last HISTORY messages are kept; older ones load when a thread scrolls
// back. A clinic's team chat is small, and every unread count is computed
// from what is held, so the read markers and the list agree.

const HISTORY = 400

export interface TeamChatMember {
  id: string
  full_name: string
  photo_storage_path: string | null
}

let channel: ReturnType<ReturnType<typeof useSupabaseClient>['channel']> | null = null
let channelAccount: string | null = null

export function useTeamChat() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const messages = useState<TeamMessageRow[]>('team-chat-messages', () => [])
  const reads = useState<Record<string, string>>('team-chat-reads', () => ({}))
  const members = useState<TeamChatMember[]>('team-chat-members', () => [])
  const loaded = useState<boolean>('team-chat-loaded', () => false)
  const now = useState<number>('team-chat-now', () => Date.now())

  const me = computed(() => store.teamMember?.id ?? '')

  function upsert(row: TeamMessageRow) {
    const i = messages.value.findIndex((m) => m.id === row.id)
    if (i >= 0) messages.value.splice(i, 1, row)
    else messages.value = [...messages.value, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async function load() {
    const accountId = store.accountId
    if (!accountId) return
    const [msgs, rd, mem] = await Promise.all([
      supabase
        .from('team_messages')
        .select('id, sender_id, recipient_id, kind, body, created_at, room_id, clinic_id, acknowledged_by, acknowledged_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(HISTORY),
      supabase.from('team_message_reads').select('thread_key, last_read_at').eq('account_id', accountId),
      supabase.from('team_members').select('id, full_name, photo_storage_path').eq('account_id', accountId).is('deleted_at', null).order('full_name'),
    ])
    messages.value = ((msgs.data ?? []) as TeamMessageRow[]).reverse()
    reads.value = Object.fromEntries((rd.data ?? []).map((r) => [r.thread_key, r.last_read_at]))
    members.value = (mem.data ?? []) as TeamChatMember[]
    loaded.value = true
  }

  /** Starts the one shared subscription; the layout calls it once. */
  function start() {
    const accountId = store.accountId
    if (!accountId || channelAccount === accountId) return
    if (channel) supabase.removeChannel(channel)
    channelAccount = accountId
    load()
    channel = supabase
      .channel(`team-messages-${accountId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages', filter: `account_id=eq.${accountId}` }, (payload) => {
        if (payload.new && (payload.new as TeamMessageRow).id) upsert(payload.new as TeamMessageRow)
      })
      .subscribe()
    // Alerts expire from the banner by age; this keeps "now" moving without
    // a timer per alert.
    if (import.meta.client) setInterval(() => (now.value = Date.now()), 60_000)
  }

  function stop() {
    if (channel) supabase.removeChannel(channel)
    channel = null
    channelAccount = null
  }

  const unread = computed(() => unreadByThread(messages.value, me.value, reads.value))
  const unreadTotal = computed(() => Object.values(unread.value).reduce((a, b) => a + b, 0))
  const alerts = computed(() => openAlerts(messages.value, now.value))

  function thread(key: ThreadKey) {
    return messages.value.filter((m) => threadOf(m, me.value) === key)
  }

  function memberName(id: string | null | undefined) {
    return members.value.find((m) => m.id === id)?.full_name ?? ''
  }

  async function markRead(key: ThreadKey) {
    const accountId = store.accountId
    if (!accountId || !me.value) return
    const last = thread(key).at(-1)?.created_at
    if (!last || (reads.value[key] && reads.value[key] >= last)) return
    reads.value = { ...reads.value, [key]: last }
    await supabase.from('team_message_reads').upsert({ team_member_id: me.value, account_id: accountId, thread_key: key, last_read_at: last })
  }

  async function send(key: ThreadKey, body: string) {
    const res = await useStaffFetch<{ id: string; createdAt: string }>('/api/team-messages/send', {
      method: 'POST',
      body: { recipientId: key === 'team' ? null : key, body },
    })
    // Realtime brings the row too; adding it now means the sender sees it
    // without waiting on the socket.
    upsert({ id: res.id, sender_id: me.value, recipient_id: key === 'team' ? null : key, kind: 'message', body, created_at: res.createdAt, room_id: null, clinic_id: null, acknowledged_by: null, acknowledged_at: null })
    await markRead(key)
  }

  async function raiseAlert(body: string, roomId: string | null) {
    const res = await useStaffFetch<{ id: string; createdAt: string }>('/api/team-messages/send', {
      method: 'POST',
      body: { kind: 'alert', body, roomId, clinicId: store.currentClinicId ?? null },
    })
    upsert({ id: res.id, sender_id: me.value, recipient_id: null, kind: 'alert', body, created_at: res.createdAt, room_id: roomId, clinic_id: store.currentClinicId ?? null, acknowledged_by: null, acknowledged_at: null })
  }

  async function acknowledge(id: string) {
    const { error } = await supabase.rpc('acknowledge_team_alert', { p_message_id: id })
    if (error) throw error
    const m = messages.value.find((x) => x.id === id)
    if (m && !m.acknowledged_at) upsert({ ...m, acknowledged_by: me.value, acknowledged_at: new Date().toISOString() })
  }

  return { messages, members, loaded, me, unread, unreadTotal, alerts, thread, memberName, load, start, stop, markRead, send, raiseAlert, acknowledge }
}
