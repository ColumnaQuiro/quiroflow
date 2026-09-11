<script setup lang="ts">
// The patient's conversation with the clinic. Lifted out of
// mobile/pages/messages.vue so the web portal gets it too -- the mobile
// page now renders this, and keeps its own back-button chrome.
//
// Sends through /api/patient-messages/send rather than inserting directly,
// because the insert has to be paired with notifying the other side, and
// that is a server-side step regardless of which front end is calling.
const props = defineProps<{
  patientId: string
  /** Mobile gives it the full remaining screen; the portal wants it boxed. */
  height?: string
}>()

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()

interface Message {
  id: string
  direction: string
  body: string
  created_at: string
}

const messages = ref<Message[]>([])
const loading = ref(true)
const messagesEl = ref<HTMLElement>()
const composerText = ref('')
const sending = ref(false)
const sendError = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patient_app_messages')
    .select('id, direction, body, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: true })
  messages.value = data ?? []
  loading.value = false
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  })
}

async function sendText() {
  if (!composerText.value.trim()) return
  sendError.value = ''
  sending.value = true
  try {
    await authedFetch('/api/patient-messages/send', {
      method: 'POST',
      body: { patientId: props.patientId, text: composerText.value.trim() },
    })
    composerText.value = ''
    await load()
  } catch (err: unknown) {
    sendError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Failed to send', 'No se pudo enviar')
  } finally {
    sending.value = false
  }
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// A reply arriving while the thread is open should appear without the
// patient pulling to refresh -- the same realtime subscription the mobile
// page has had, now shared.
let channel: ReturnType<typeof supabase.channel> | null = null
function subscribe(patientId: string) {
  if (channel) supabase.removeChannel(channel)
  channel = supabase
    .channel(`patient-messages-${patientId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `patient_id=eq.${patientId}` }, () => load())
    .subscribe()
}

watch(
  () => props.patientId,
  (id) => {
    if (!id) return
    load()
    subscribe(id)
  },
  { immediate: true },
)
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex min-h-0 flex-col" :style="height ? { height } : undefined">
    <div ref="messagesEl" class="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
      <p v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</p>
      <p v-else-if="messages.length === 0" class="p-6 text-center text-[13px] text-ink-faint">
        {{ t('Send a message and the clinic will get back to you here.', 'Escribe un mensaje y la clínica te responderá aquí.') }}
      </p>
      <div v-for="m in messages" :key="m.id" class="flex" :class="m.direction === 'inbound' ? 'justify-end' : 'justify-start'">
        <div
          class="max-w-[80%] rounded-card px-3 py-2 shadow-card"
          :class="m.direction === 'inbound' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-900'"
        >
          <p class="whitespace-pre-wrap text-[13.5px]">{{ m.body }}</p>
          <p class="mt-1 text-right text-[10.5px]" :class="m.direction === 'inbound' ? 'text-white/70' : 'text-ink-faint'">{{ shortTime(m.created_at) }}</p>
        </div>
      </div>
    </div>

    <div class="shrink-0 border-t border-line bg-surface p-3">
      <p v-if="sendError" class="mb-2 text-[12.5px] text-danger-text">{{ sendError }}</p>
      <!-- Centred, not bottom-aligned: the textarea never grows (rows=1,
           fixed height, it scrolls internally), so "align to the bottom"
           only ever meant the 32px Send button sat 6px below the middle of
           the 44px field. -->
      <div class="flex items-center gap-2">
        <textarea
          v-model="composerText"
          rows="1"
          :placeholder="t('Type a message…', 'Escribe un mensaje…')"
          class="max-h-24 min-h-11 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
          @keydown.enter.exact.prevent="sendText"
        />
        <UiBtn variant="primary" :disabled="sending || !composerText.trim()" @click="sendText">
          {{ sending ? '…' : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
