<script setup lang="ts">
import type { ThreadKey } from '../../utils/teamMessages'

// Team: messages between the people who work here -- the whole team in one
// thread, and one thread with each colleague. The web's pages/team-chat.vue,
// at the same path, so a push's url (/team-chat?thread=…, from
// server/api/team-messages/send.post.ts) opens the same conversation here.
// Every staff member has it, Inbox or not; what each person can read is
// RLS's (20261020074859_team_messages.sql).
//
// Kept alive between tabs, as the Inbox is: back from the Calendar, the same
// conversation is still open.
defineOptions({ name: 'StaffTeamChatPage' })
definePageMeta({ layout: 'practitioner', keepalive: true })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const route = useRoute()
const router = useRouter()
const { context, loading: contextLoading } = usePractitionerContext()
const chat = useStaffTeamChat()
const { members, me, unread, loaded } = chat
const { keyboardHeight } = useKeyboardInset()
const locale = computed(() => t('en-GB', 'es-ES'))

const selected = ref<ThreadKey | null>(typeof route.query.thread === 'string' ? route.query.thread : null)
// A notification tap while this tab is already open changes only the query.
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
function close() {
  selected.value = null
  const { thread: _thread, ...rest } = route.query
  router.replace({ query: rest })
}

// Edge-swipe from the thread back to the list, as in the Inbox.
const threadEl = ref<HTMLElement>()
const swipeBack = useSwipeBack(close)
watch(threadEl, (el, prevEl) => {
  if (prevEl) swipeBack.detach(prevEl)
  if (el) swipeBack.attach(el)
})

const scroller = ref<HTMLElement | null>(null)
const { active } = useKeptAlive({ onReturn: () => markOpenRead() })
function markOpenRead() {
  if (selected.value && active.value && document.visibilityState === 'visible') chat.markRead(selected.value)
}
watch(
  () => [selected.value, current.value.length],
  async () => {
    if (!selected.value) return
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    markOpenRead()
  },
  { immediate: true },
)
watch(keyboardHeight, async (h) => {
  if (!h) return
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
})

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
  } catch (e: unknown) {
    sendError.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not send. Try again.', 'No se pudo enviar. Inténtalo de nuevo.')
  } finally {
    sending.value = false
  }
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}
// Hour today, "Yesterday", then the date: as the Inbox's list.
function when(iso: string) {
  const d = new Date(iso)
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return time(iso)
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
}
function bubbleTime(iso: string) {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? time(iso) : `${d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })} ${time(iso)}`
}
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col bg-surface-page">
    <AppPageHeader :title="t('Team', 'Equipo')">
      <StaffHelpButton v-if="context" />
    </AppPageHeader>

    <AppSkeletonList v-if="contextLoading || (context && !loaded)" avatar class="min-h-0 flex-1" />
    <p v-else-if="!context" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      {{ t("This account isn't linked to a team record.", 'Esta cuenta no está vinculada a una ficha de equipo.') }}
    </p>
    <div v-else class="flex min-h-0 flex-1">
      <ul class="min-h-0 w-full overflow-y-auto bg-surface lg:w-[340px] lg:shrink-0 lg:border-r lg:border-line" data-cy="team-threads">
        <li v-for="r in threads" :key="r.key" class="border-b border-line last:border-b-0">
          <button
            type="button"
            class="flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-subtle"
            :class="selected === r.key ? 'lg:bg-brand-tint' : ''"
            :data-cy="`team-thread-${r.key === 'team' ? 'team' : 'member'}`"
            @click="open(r.key)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" :class="r.key === 'team' ? 'bg-brand text-white' : 'bg-brand-tint text-brand-text'">
              {{ r.key === 'team' ? '#' : initials(r.name) }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-[15px]" :class="r.unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-700'">{{ r.name }}</span>
                <span v-if="r.lastAt" class="shrink-0 text-[12px]" :class="r.unread ? 'font-semibold text-brand-text' : 'text-ink-faint'">{{ when(r.lastAt) }}</span>
              </span>
              <span class="flex items-center justify-between gap-2">
                <span class="truncate text-[13px] text-ink-muted">{{ r.last ?? (r.key === 'team' ? t('Everyone who works here', 'Todas las personas de la clínica') : t('No messages yet', 'Sin mensajes todavía')) }}</span>
                <span v-if="r.unread" class="flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white" data-cy="team-thread-unread">{{ r.unread }}</span>
              </span>
            </span>
          </button>
        </li>
      </ul>

      <!-- The thread: over the whole screen on a phone (its own bar replaces
           the page's), beside the list on an iPad. -->
      <div
        v-if="selected || swipeBack.active.value"
        ref="threadEl"
        class="absolute inset-0 z-30 flex min-h-0 flex-col bg-surface-page shadow-[-2px_0_12px_rgba(0,0,0,0.12)] lg:left-[340px] lg:top-14 lg:shadow-none"
        :style="{
          transform: `translateX(${swipeBack.dragX.value}px)`,
          transition: swipeBack.dragging.value ? 'none' : 'transform 200ms ease-out',
          paddingBottom: keyboardHeight + 'px',
        }"
        data-cy="team-thread"
      >
        <div class="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-brand-text lg:hidden" :aria-label="t('Back to conversations', 'Volver a las conversaciones')" @click="close">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <h2 class="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink-900 lg:pl-2">{{ currentName }}</h2>
        </div>
        <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <p v-if="current.length === 0" class="py-10 text-center text-[13.5px] text-ink-faint">
            {{ selected === 'team' ? t('Say something to the whole team.', 'Escribe algo a todo el equipo.') : t(`Start a conversation with ${currentName}.`, `Empieza una conversación con ${currentName}.`) }}
          </p>
          <div v-for="m in current" :key="m.id" class="mb-2 flex" :class="m.sender_id === me ? 'justify-end' : 'justify-start'" data-cy="team-message">
            <div
              class="max-w-[80%] rounded-[16px] px-3 py-2"
              :class="m.kind === 'alert' ? 'border border-danger-border bg-danger-bg text-danger-text' : m.sender_id === me ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900'"
            >
              <p v-if="m.sender_id !== me && selected === 'team'" class="mb-0.5 text-[12px] font-semibold" :class="m.kind === 'alert' ? '' : 'text-brand-text'">{{ chat.memberName(m.sender_id) }}</p>
              <p v-if="m.kind === 'alert'" class="text-[11.5px] font-bold uppercase tracking-[.04em]">{{ t('Help needed', 'Piden ayuda') }}</p>
              <p class="whitespace-pre-wrap break-words text-[15px] leading-snug">{{ m.body }}</p>
              <p class="mt-0.5 text-right text-[11px] opacity-70">
                {{ bubbleTime(m.created_at) }}
                <template v-if="m.kind === 'alert' && m.acknowledged_at"> · {{ t(`${chat.memberName(m.acknowledged_by)} answered`, `${chat.memberName(m.acknowledged_by)} respondió`) }}</template>
              </p>
            </div>
          </div>
        </div>
        <p v-if="sendError" class="shrink-0 border-t border-danger-border bg-danger-bg px-3.5 py-2 text-[13px] text-danger-text" role="alert">{{ sendError }}</p>
        <form class="flex shrink-0 items-end gap-2 border-t border-line bg-surface p-2.5" @submit.prevent="send">
          <textarea
            v-model="draft"
            rows="1"
            maxlength="2000"
            enterkeyhint="send"
            :aria-label="t('Message', 'Mensaje')"
            :placeholder="selected === 'team' ? t('Message the whole team…', 'Mensaje a todo el equipo…') : t(`Message ${currentName}…`, `Mensaje a ${currentName}…`)"
            class="block max-h-24 min-h-11 min-w-0 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[15px] text-ink-900 placeholder:text-ink-faint focus:border-brand focus:outline-none"
            data-cy="team-composer"
            @keydown.enter.exact.prevent="send"
          />
          <button
            type="submit"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl bg-brand text-white disabled:opacity-50"
            :disabled="sending || !draft.trim()"
            :aria-label="t('Send', 'Enviar')"
            data-cy="team-send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      </div>
      <div v-else class="hidden min-w-0 flex-1 items-center justify-center text-[13.5px] text-ink-faint lg:flex">
        {{ t('Pick a conversation', 'Elige una conversación') }}
      </div>
    </div>
  </div>
</template>
