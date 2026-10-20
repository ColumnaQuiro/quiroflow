<script setup lang="ts">
import { formatTime, formatShortDate } from '~/utils/billing'
import type { ThreadKey } from '~/utils/teamMessages'

// Team: messages between the people who work here -- the whole team in one
// thread, and one thread with each colleague. Reached from the Inbox's
// "Patients | Team" switch, and from the sidebar for everyone, because the
// people who most need it (practitioners asking the desk for the next
// patient) are the ones whose role has no Inbox. Open to every team member
// for the same reason; what each person can read is RLS's
// (20261020074859_team_messages.sql).
const t = useT()
const route = useRoute()
const router = useRouter()
const chat = useTeamChat()
const { members, me, unread } = chat

const selected = ref<ThreadKey | null>(typeof route.query.thread === 'string' ? route.query.thread : null)
watch(
  () => route.query.thread,
  (q) => {
    if (typeof q === 'string') selected.value = q
  },
)

const colleagues = computed(() => members.value.filter((m) => m.id !== me.value))

interface ThreadRow {
  key: ThreadKey
  name: string
  last: string | null
  lastAt: string | null
  unread: number
}
const threads = computed<ThreadRow[]>(() => {
  const rows: ThreadRow[] = [{ key: 'team', name: t('Whole team', 'Todo el equipo'), last: null, lastAt: null, unread: unread.value.team ?? 0 }]
  for (const c of colleagues.value) rows.push({ key: c.id, name: c.full_name, last: null, lastAt: null, unread: unread.value[c.id] ?? 0 })
  for (const r of rows) {
    const lastMsg = chat.thread(r.key).at(-1)
    r.last = lastMsg ? `${lastMsg.sender_id === me.value ? `${t('You', 'Tú')}: ` : r.key === 'team' ? `${chat.memberName(lastMsg.sender_id).split(' ')[0]}: ` : ''}${lastMsg.body}` : null
    r.lastAt = lastMsg?.created_at ?? null
  }
  // The team thread first, then whoever wrote last, then everyone else by name.
  const [team, ...rest] = rows
  rest.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.name.localeCompare(b.name, 'es'))
  return [team!, ...rest]
})

const current = computed(() => (selected.value ? chat.thread(selected.value) : []))
const currentName = computed(() => threads.value.find((r) => r.key === selected.value)?.name ?? '')

function open(key: ThreadKey) {
  selected.value = key
  router.replace({ query: { ...route.query, thread: key } })
}

const scroller = ref<HTMLElement | null>(null)
watch(
  () => [selected.value, current.value.length],
  async () => {
    if (!selected.value) return
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    chat.markRead(selected.value)
  },
  { immediate: true },
)

const draft = ref('')
const sending = ref(false)
const sendError = ref('')
async function send() {
  const text = draft.value.trim()
  if (!text || !selected.value || sending.value) return
  sending.value = true
  sendError.value = ''
  try {
    await chat.send(selected.value, text)
    draft.value = ''
  } catch (e: any) {
    sendError.value = e?.data?.statusMessage ?? t('Could not send. Try again.', 'No se pudo enviar. Inténtalo de nuevo.')
  } finally {
    sending.value = false
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

function when(iso: string) {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? formatTime(iso) : `${formatShortDate(iso)} ${formatTime(iso)}`
}

onMounted(() => {
  chat.start()
  if (!chat.loaded.value) chat.load()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Team', 'Equipo')">
      <InboxTeamSwitch current="team" />
    </PageHeader>
    <div class="flex flex-1 overflow-hidden">
      <div class="w-full flex-col border-r border-line bg-surface md:flex md:w-[300px] md:shrink-0" :class="selected ? 'hidden md:flex' : 'flex'" data-cy="team-threads">
        <ul class="flex-1 overflow-y-auto py-1">
          <li v-for="r in threads" :key="r.key">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-subtle"
              :class="selected === r.key ? 'bg-brand-tint' : ''"
              :data-cy="`team-thread-${r.key === 'team' ? 'team' : 'member'}`"
              :data-key="r.key"
              @click="open(r.key)"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold" :class="r.key === 'team' ? 'bg-brand text-surface' : 'bg-chip-bg text-ink-700'">
                {{ r.key === 'team' ? '#' : r.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() }}
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="flex items-center justify-between gap-2">
                  <span class="truncate text-[14px]" :class="r.unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-700'">{{ r.name }}</span>
                  <span v-if="r.lastAt" class="shrink-0 font-mono text-[11px] text-ink-faint">{{ when(r.lastAt) }}</span>
                </span>
                <span class="flex items-center justify-between gap-2">
                  <span class="truncate text-[12.5px] text-ink-muted">{{ r.last ?? (r.key === 'team' ? t('Everyone who works here', 'Todas las personas de la clínica') : t('No messages yet', 'Sin mensajes todavía')) }}</span>
                  <span v-if="r.unread" class="shrink-0 rounded-pill bg-brand px-1.5 py-px text-[10.5px] font-semibold text-surface" data-cy="team-thread-unread">{{ r.unread }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="selected" class="flex min-w-0 flex-1 flex-col bg-surface-page" data-cy="team-thread">
        <div class="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          <button type="button" class="flex h-9 w-9 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle md:hidden" :aria-label="t('Back', 'Volver')" @click="selected = null">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5" /></svg>
          </button>
          <h2 class="truncate text-[15px] font-bold text-ink-900">{{ currentName }}</h2>
        </div>
        <div ref="scroller" class="flex-1 overflow-y-auto px-4 py-3">
          <p v-if="current.length === 0" class="py-10 text-center text-[13px] text-ink-faint">
            {{ selected === 'team' ? t('Say something to the whole team.', 'Escribe algo a todo el equipo.') : t(`Start a conversation with ${currentName}.`, `Empieza una conversación con ${currentName}.`) }}
          </p>
          <div v-for="m in current" :key="m.id" class="mb-2 flex" :class="m.sender_id === me ? 'justify-end' : 'justify-start'" data-cy="team-message">
            <div
              class="max-w-[75%] rounded-card px-3 py-2"
              :class="m.kind === 'alert' ? 'border border-danger-border bg-danger-bg text-danger-text' : m.sender_id === me ? 'bg-brand text-surface' : 'border border-line bg-surface text-ink-900'"
            >
              <p v-if="m.sender_id !== me && selected === 'team'" class="mb-0.5 text-[11.5px] font-semibold" :class="m.kind === 'alert' ? '' : 'text-brand-text'">{{ chat.memberName(m.sender_id) }}</p>
              <p v-if="m.kind === 'alert'" class="text-[11.5px] font-bold uppercase tracking-[.04em]">{{ t('Help needed', 'Piden ayuda') }}</p>
              <p class="whitespace-pre-wrap break-words text-[14px] leading-snug">{{ m.body }}</p>
              <p class="mt-0.5 text-right font-mono text-[10.5px] opacity-70">
                {{ when(m.created_at) }}
                <template v-if="m.kind === 'alert' && m.acknowledged_at"> · {{ t(`${chat.memberName(m.acknowledged_by)} answered`, `${chat.memberName(m.acknowledged_by)} respondió`) }}</template>
              </p>
            </div>
          </div>
        </div>
        <form class="flex shrink-0 items-end gap-2 border-t border-line bg-surface p-3" @submit.prevent="send">
          <textarea
            v-model="draft"
            rows="1"
            maxlength="2000"
            data-cy="team-composer"
            :placeholder="selected === 'team' ? t('Message the whole team…', 'Mensaje a todo el equipo…') : t(`Message ${currentName}…`, `Mensaje a ${currentName}…`)"
            class="max-h-40 min-h-[40px] flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none"
            @keydown="onKey"
          />
          <button type="submit" data-cy="team-send" :disabled="sending || !draft.trim()" class="h-10 shrink-0 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover disabled:opacity-50">
            {{ t('Send', 'Enviar') }}
          </button>
        </form>
        <p v-if="sendError" class="bg-surface px-3 pb-2 text-[12.5px] text-danger-text" role="alert">{{ sendError }}</p>
      </div>
      <div v-else class="hidden flex-1 items-center justify-center text-[13.5px] text-ink-faint md:flex">
        {{ t('Pick a conversation', 'Elige una conversación') }}
      </div>
    </div>
  </div>
</template>
