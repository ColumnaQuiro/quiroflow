import type { TeamMessageRow, ThreadKey } from '../../utils/teamMessages'

// Team messages and the help alert (20261020074859_team_messages.sql) in the
// app: the web's composables/useTeamChat.ts, ported rather than reused
// because that one reads the Pinia account store and useStaffFetch, neither
// of which this bundle has. The rules themselves -- which thread a message
// is in, what counts as unread, which alerts are still open -- are the
// shared utils/teamMessages.ts, so the two cannot disagree.
//
// One subscription for the whole app, started by the staff layout: an alert
// has to reach whatever screen a colleague is on, not only someone who has
// the Team tab open. RLS decides what arrives -- realtime applies the select
// policy -- so a direct message between two colleagues never reaches a third.
//
// A phone drops its socket whenever the app goes to the background, and an
// alert raised meanwhile must still be on screen when it comes back, so the
// whole window is read again on every return and every reconnect.
//
// The last HISTORY messages are kept, as on the web; every unread count is
// computed from what is held, so the badge and the list agree.

const HISTORY = 400

export interface StaffTeamMember {
  id: string
  full_name: string
}

const COLUMNS = 'id, sender_id, recipient_id, kind, body, created_at, room_id, clinic_id, acknowledged_by, acknowledged_at'

const messages = ref<TeamMessageRow[]>([])
const reads = ref<Record<string, string>>({})
const members = ref<StaffTeamMember[]>([])
const loaded = ref(false)
const now = ref(Date.now())
// Who the state above belongs to; a sign-out or a switch of account clears it.
const owner = ref<{ accountId: string; teamMemberId: string } | null>(null)

let channel: ReturnType<ReturnType<typeof useSupabaseClient>['channel']> | null = null
let run = 0
let hooked = false

export function useStaffTeamChat() {
  const supabase = useSupabaseClient()
  const authedFetch = useAuthedFetch()

  const me = computed(() => owner.value?.teamMemberId ?? '')

  function upsert(row: TeamMessageRow) {
    const i = messages.value.findIndex((m) => m.id === row.id)
    if (i >= 0) messages.value.splice(i, 1, row)
    else messages.value = [...messages.value, row].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async function load() {
    const who = owner.value
    if (!who) return
    const mine = ++run
    const [msgs, rd, mem] = await Promise.all([
      supabase.from('team_messages').select(COLUMNS).eq('account_id', who.accountId).order('created_at', { ascending: false }).limit(HISTORY),
      supabase.from('team_message_reads').select('thread_key, last_read_at').eq('account_id', who.accountId),
      supabase.from('team_members').select('id, full_name').eq('account_id', who.accountId).is('deleted_at', null).order('full_name'),
    ])
    // A newer load, or a different person signed in since: this answer is stale.
    if (mine !== run || owner.value !== who) return
    // A failed read keeps what is held rather than emptying the screen --
    // "no messages" would be a claim, not a fact.
    if (!msgs.error) messages.value = ((msgs.data ?? []) as TeamMessageRow[]).reverse()
    if (!rd.error) reads.value = Object.fromEntries((rd.data ?? []).map((r) => [r.thread_key, r.last_read_at]))
    if (!mem.error) members.value = (mem.data ?? []) as StaffTeamMember[]
    loaded.value = !msgs.error || loaded.value
  }

  function stop() {
    if (channel) supabase.removeChannel(channel)
    channel = null
    owner.value = null
    run++
    messages.value = []
    reads.value = {}
    members.value = []
    loaded.value = false
  }

  /** The staff layout calls this with whoever is signed in (null: nobody). */
  function start(who: { accountId: string; teamMemberId: string } | null) {
    if (who && owner.value?.accountId === who.accountId && owner.value.teamMemberId === who.teamMemberId) return
    stop()
    if (!who) return
    owner.value = who
    load()
    let joined = false
    channel = supabase
      .channel(`mobile-team-messages-${who.accountId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages', filter: `account_id=eq.${who.accountId}` }, (payload) => {
        if (payload.new && (payload.new as TeamMessageRow).id) upsert(payload.new as TeamMessageRow)
      })
      // SUBSCRIBED again after a dropped socket: whatever was said in between
      // never came through it.
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        if (joined) load()
        joined = true
      })
    if (!hooked) {
      hooked = true
      // Alerts leave the banner by age; this keeps "now" moving without a
      // timer per alert.
      setInterval(() => (now.value = Date.now()), 30_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        now.value = Date.now()
        load()
      })
    }
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
    const who = owner.value
    if (!who) return
    const last = thread(key).at(-1)?.created_at
    if (!last || (reads.value[key] && reads.value[key] >= last)) return
    reads.value = { ...reads.value, [key]: last }
    await supabase.from('team_message_reads').upsert({ team_member_id: who.teamMemberId, account_id: who.accountId, thread_key: key, last_read_at: last } as never)
  }

  async function send(key: ThreadKey, body: string) {
    const recipientId = key === 'team' ? null : key
    const res = await authedFetch<{ id: string; createdAt: string }>('/api/team-messages/send', { method: 'POST', body: { recipientId, body } })
    // Realtime brings the row too; adding it now means the sender sees it
    // without waiting on the socket.
    upsert({ id: res.id, sender_id: me.value, recipient_id: recipientId, kind: 'message', body, created_at: res.createdAt, room_id: null, clinic_id: null, acknowledged_by: null, acknowledged_at: null })
    await markRead(key)
  }

  async function raiseAlert(body: string, roomId: string | null, clinicId: string | null) {
    const res = await authedFetch<{ id: string; createdAt: string }>('/api/team-messages/send', { method: 'POST', body: { kind: 'alert', body, roomId, clinicId } })
    upsert({ id: res.id, sender_id: me.value, recipient_id: null, kind: 'alert', body, created_at: res.createdAt, room_id: roomId, clinic_id: clinicId, acknowledged_by: null, acknowledged_at: null })
  }

  async function acknowledge(id: string) {
    const { error } = await supabase.rpc('acknowledge_team_alert' as never, { p_message_id: id } as never)
    if (error) throw error
    const m = messages.value.find((x) => x.id === id)
    if (m && !m.acknowledged_at) upsert({ ...m, acknowledged_by: me.value, acknowledged_at: new Date().toISOString() })
  }

  return { messages, members, loaded, me, now, unread, unreadTotal, alerts, thread, memberName, load, start, stop, markRead, send, raiseAlert, acknowledge }
}
