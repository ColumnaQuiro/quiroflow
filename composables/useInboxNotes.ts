import type { InboxNote } from '../utils/inboxNotes'

// The internal notes on the conversation open in an Inbox (inbox_notes), kept
// current while it is open: a colleague's note arrives through realtime. Used
// by the web Inbox and the staff app's alike; `notifyMentions` is how each
// reaches the API (the web's own origin, or the app's deployed one), for the
// push to whoever a note names.
export function useInboxNotes(opts: {
  accountId: () => string | null | undefined
  conversationKey: () => string | null | undefined
  authorId: () => string | null | undefined
  notifyMentions: (noteId: string) => Promise<unknown>
}) {
  const supabase = useSupabaseClient()
  const notes = ref<InboxNote[]>([])
  const saving = ref(false)
  const error = ref('')

  let run = 0
  async function load() {
    const key = opts.conversationKey()
    const mine = ++run
    if (!key) {
      notes.value = []
      return
    }
    const { data } = await supabase.from('inbox_notes').select('id, conversation_key, author_id, body, mentions, created_at').eq('conversation_key', key).order('created_at')
    if (mine !== run) return
    notes.value = (data as InboxNote[] | null) ?? []
  }
  watch(opts.conversationKey, () => {
    notes.value = []
    load()
  }, { immediate: true })

  async function add(body: string, mentions: string[]) {
    const accountId = opts.accountId()
    const key = opts.conversationKey()
    const authorId = opts.authorId()
    const text = body.trim()
    if (!accountId || !key || !authorId || !text || saving.value) return false
    saving.value = true
    error.value = ''
    // A client-made id: the push is asked for by it, without reading the row back.
    const id = crypto.randomUUID()
    const { error: e } = await supabase.from('inbox_notes').insert({ id, account_id: accountId, conversation_key: key, author_id: authorId, body: text, mentions } as never)
    saving.value = false
    if (e) {
      error.value = e.message
      return false
    }
    notes.value = [...notes.value, { id, conversation_key: key, author_id: authorId, body: text, mentions, created_at: new Date().toISOString() }]
    if (mentions.length) opts.notifyMentions(id).catch(() => {})
    return true
  }

  async function remove(id: string) {
    const before = notes.value
    notes.value = notes.value.filter((n) => n.id !== id)
    const { error: e } = await supabase.from('inbox_notes').delete().eq('id', id)
    if (e) notes.value = before
  }

  let channel: ReturnType<typeof supabase.channel> | null = null
  onMounted(() => {
    const accountId = opts.accountId()
    if (!accountId) return
    channel = supabase
      .channel(`inbox-notes-${accountId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_notes', filter: `account_id=eq.${accountId}` }, (payload) => {
        const row = (payload.new ?? payload.old) as { conversation_key?: string } | null
        if (!row?.conversation_key || row.conversation_key === opts.conversationKey()) load()
      })
      .subscribe()
  })
  onBeforeUnmount(() => {
    if (channel) supabase.removeChannel(channel)
  })

  return { notes, saving, error, load, add, remove }
}
