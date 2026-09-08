<script setup lang="ts">
// Floating help assistant. Answers from the help centre first (server/api/
// support/ask.post.ts), and hands off to a real person when it can't -- the
// escalation becomes a support_conversations thread answered from the admin
// panel, and the reply comes back into this same panel.
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { preference: langPreference } = useLang()
const route = useRoute()

// The inbox's composer sits at the bottom of the screen with its own Send
// button flush right -- on a narrow viewport that's the same corner this
// widget's floating launcher occupies (fixed bottom-5 right-5), so it sits
// on top of the Send button rather than beside it. Sidebar's "Help Centre"
// link still reaches docs from there; the assistant stays one click away
// on every other page.
const hideOnRoute = computed(() => route.path === '/inbox')

interface Turn {
  role: 'user' | 'assistant'
  text: string
  sources?: string[]
  // Set on the assistant turn that admitted it couldn't help, so the offer
  // to reach a person appears exactly there rather than under every answer.
  offerHuman?: boolean
}

const open = ref(false)
const question = ref('')
const asking = ref(false)
const turns = ref<Turn[]>([])

// --- escalation ----------------------------------------------------------
// Threads are per-account, so a colleague's open question is one this user
// can see and continue -- support is a clinic-level conversation with us,
// not a private one per team member.
const mode = ref<'assistant' | 'human'>('assistant')
const conversationId = ref<string | null>(null)
const humanMessage = ref('')
const sending = ref(false)
const thread = ref<{ id: string; direction: string; body: string; created_at: string }[]>([])
const unreadReply = ref(false)

const scroller = ref<HTMLElement | null>(null)
async function scrollToEnd() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

// --- assistant history ----------------------------------------------------
const loadingHistory = ref(true)
async function loadAssistantHistory() {
  const { data } = await supabase
    .from('help_assistant_messages')
    .select('role, body, sources, offer_human')
    .order('created_at')
  turns.value = (data ?? []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    text: m.body,
    sources: m.sources ?? undefined,
    offerHuman: m.offer_human,
  }))
  loadingHistory.value = false
}

async function ask() {
  const text = question.value.trim()
  if (!text || asking.value) return
  question.value = ''
  turns.value.push({ role: 'user', text })
  asking.value = true
  await scrollToEnd()

  try {
    const res = await useStaffFetch<{ available: boolean; answer: string; sources: string[] }>('/api/support/ask', {
      method: 'POST',
      body: { question: text, language: langPreference.value === 'es' ? 'es' : 'en' },
    })
    if (!res.available) {
      // No API key, or the model call failed -- either way the useful thing
      // is a person, not an error message.
      turns.value.push({
        role: 'assistant',
        text: t("I can't answer questions right now, but the QuiroFlow team can.", 'Ahora mismo no puedo responder preguntas, pero el equipo de QuiroFlow sí.'),
        offerHuman: true,
      })
    } else {
      turns.value.push({ role: 'assistant', text: res.answer, sources: res.sources, offerHuman: res.sources.length === 0 })
    }
  } catch {
    turns.value.push({
      role: 'assistant',
      text: t('Something went wrong looking that up.', 'Algo ha fallado al buscar eso.'),
      offerHuman: true,
    })
  } finally {
    asking.value = false
    await scrollToEnd()
  }
}

async function loadThread() {
  if (!store.accountId) return
  const { data: conversations } = await supabase
    .from('support_conversations')
    .select('id, clinic_unread')
    .order('last_message_at', { ascending: false })
    .limit(1)
  const latest = conversations?.[0]
  if (!latest) return
  conversationId.value = latest.id
  unreadReply.value = latest.clinic_unread
  const { data: messages } = await supabase
    .from('support_messages')
    .select('id, direction, body, created_at')
    .eq('conversation_id', latest.id)
    .order('created_at')
  thread.value = messages ?? []
}
onMounted(() => {
  loadThread()
  loadAssistantHistory()
})

async function openHuman() {
  mode.value = 'human'
  await loadThread()
  await markThreadRead()
  await scrollToEnd()
}

async function markThreadRead() {
  if (!conversationId.value || !unreadReply.value) return
  unreadReply.value = false
  await supabase.from('support_conversations').update({ clinic_unread: false }).eq('id', conversationId.value)
}

async function sendToHuman() {
  const text = humanMessage.value.trim()
  if (!text || sending.value) return
  sending.value = true
  try {
    const res = await useStaffFetch<{ conversationId: string }>('/api/support/message', {
      method: 'POST',
      body: { conversationId: conversationId.value, message: text },
    })
    conversationId.value = res.conversationId
    humanMessage.value = ''
    await loadThread()
    await scrollToEnd()
  } finally {
    sending.value = false
  }
}

// Carries the failed question into the message box, so escalating doesn't
// mean typing it out a second time.
function escalateFrom(index: number) {
  const lastUser = [...turns.value.slice(0, index)].reverse().find((turn) => turn.role === 'user')
  humanMessage.value = lastUser?.text ?? ''
  openHuman()
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await loadThread()
    await scrollToEnd()
  }
}

function articleTitle(url: string) {
  const slug = url.split('/').filter(Boolean).pop() ?? ''
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
</script>

<template>
  <!-- Above page content but below modals (z-50) and toasts (z-[200]), so a
  dialog opened from behind it still covers it. -->
  <div v-if="!hideOnRoute" class="fixed bottom-5 right-5 z-40 print:hidden">
    <div
      v-if="open"
      class="mb-2.5 flex h-[min(560px,calc(100vh-7rem))] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <div class="flex shrink-0 items-center justify-between border-b border-line-divider px-4 py-2.5">
        <div class="flex items-center gap-2">
          <p class="text-[13.5px] font-[620] text-ink-900">{{ t('Help', 'Ayuda') }}</p>
          <button
            type="button"
            class="rounded-ctlSm px-1.5 py-0.5 text-[11.5px] font-medium"
            :class="mode === 'assistant' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted2 hover:bg-surface-subtle'"
            @click="mode = 'assistant'"
          >
            {{ t('Assistant', 'Asistente') }}
          </button>
          <button
            type="button"
            class="relative rounded-ctlSm px-1.5 py-0.5 text-[11.5px] font-medium"
            :class="mode === 'human' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted2 hover:bg-surface-subtle'"
            @click="openHuman"
          >
            {{ t('QuiroFlow team', 'Equipo QuiroFlow') }}
            <span v-if="unreadReply && mode !== 'human'" class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-danger-text"></span>
          </button>
        </div>
        <button type="button" class="text-ink-faint hover:text-ink-600" :title="t('Close', 'Cerrar')" @click="open = false">✕</button>
      </div>

      <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <template v-if="mode === 'assistant'">
          <p v-if="!loadingHistory && turns.length === 0" class="text-[12.5px] leading-relaxed text-ink-muted2">
            {{ t('Ask how to do something in QuiroFlow — booking, billing, reminders, settings.', 'Pregunta cómo hacer algo en QuiroFlow: reservas, facturación, recordatorios, ajustes.') }}
          </p>

          <div v-for="(turn, i) in turns" :key="i">
            <div v-if="turn.role === 'user'" class="ml-auto w-fit max-w-[85%] rounded-ctl bg-brand-tint px-3 py-1.5 text-[12.5px] text-brand-text">
              {{ turn.text }}
            </div>
            <div v-else class="max-w-[92%]">
              <p class="whitespace-pre-line text-[12.5px] leading-relaxed text-ink-700">{{ turn.text }}</p>
              <div v-if="turn.sources?.length" class="mt-1.5 flex flex-col gap-0.5">
                <a
                  v-for="url in turn.sources"
                  :key="url"
                  :href="url"
                  target="_blank"
                  rel="noopener"
                  class="text-[11.5px] font-medium text-brand-text hover:underline"
                >
                  {{ articleTitle(url) }} ↗
                </a>
              </div>
              <button
                v-if="turn.offerHuman"
                type="button"
                class="mt-2 rounded-ctl border border-line-control px-2.5 py-1 text-[11.5px] font-medium text-ink-600 hover:border-line-controlHover"
                @click="escalateFrom(i)"
              >
                {{ t('Ask a real person', 'Preguntar a una persona') }}
              </button>
            </div>
          </div>

          <p v-if="asking" class="text-[12.5px] text-ink-faint">{{ t('Looking that up…', 'Buscando…') }}</p>
        </template>

        <template v-else>
          <p v-if="thread.length === 0" class="text-[12.5px] leading-relaxed text-ink-muted2">
            {{ t("Send us a message and we'll reply here during working hours.", 'Escríbenos y te responderemos aquí en horario laboral.') }}
          </p>
          <div v-for="m in thread" :key="m.id">
            <div
              class="w-fit max-w-[85%] rounded-ctl px-3 py-1.5 text-[12.5px]"
              :class="m.direction === 'from_clinic' ? 'ml-auto bg-brand-tint text-brand-text' : 'bg-surface-subtle text-ink-700'"
            >
              <span class="whitespace-pre-line">{{ m.body }}</span>
            </div>
            <p class="mt-0.5 text-[10.5px] text-ink-faint" :class="m.direction === 'from_clinic' ? 'text-right' : ''">
              {{ m.direction === 'from_clinic' ? t('You', 'Tú') : t('QuiroFlow', 'QuiroFlow') }} ·
              {{ new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}
            </p>
          </div>
        </template>
      </div>

      <form v-if="mode === 'assistant'" class="flex shrink-0 gap-2 border-t border-line-divider p-2.5" @submit.prevent="ask">
        <input
          v-model="question"
          type="text"
          :placeholder="t('Ask a question…', 'Haz una pregunta…')"
          class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
        />
        <UiBtn variant="primary" size="sm" type="submit" :disabled="asking || !question.trim()">{{ t('Ask', 'Enviar') }}</UiBtn>
      </form>
      <form v-else class="flex shrink-0 gap-2 border-t border-line-divider p-2.5" @submit.prevent="sendToHuman">
        <input
          v-model="humanMessage"
          type="text"
          :placeholder="t('Message the QuiroFlow team…', 'Escribe al equipo de QuiroFlow…')"
          class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
        />
        <UiBtn variant="primary" size="sm" type="submit" :disabled="sending || !humanMessage.trim()">{{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}</UiBtn>
      </form>
    </div>

    <button
      type="button"
      class="relative ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-popover hover:bg-brand-hover"
      :title="t('Help', 'Ayuda')"
      @click="toggle"
    >
      <svg v-if="!open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 20.5l1.6-4.1A8.4 8.4 0 0 1 3.6 12a8.4 8.4 0 0 1 8.4-8.5 8.4 8.4 0 0 1 9 8Z" />
      </svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      <span v-if="unreadReply && !open" class="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-surface bg-danger-text"></span>
    </button>
  </div>
</template>
