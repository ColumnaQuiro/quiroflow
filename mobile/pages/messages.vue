<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { patient, loading: identityLoading } = useIdentity()

interface Message {
  id: string
  direction: string
  body: string
  created_at: string
}

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const messages = ref<Message[]>([])
const loading = ref(true)
const messagesEl = ref<HTMLElement>()

async function load() {
  if (!patient.value) return
  loading.value = true
  const { data } = await supabase
    .from('patient_app_messages')
    .select('id, direction, body, created_at')
    .eq('patient_id', patient.value.id)
    .order('created_at', { ascending: true })
  messages.value = data ?? []
  loading.value = false
  nextTick(() => { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight })
}
watch(patient, load, { immediate: true })

const composerText = ref('')
const sending = ref(false)
const sendError = ref('')

async function sendText() {
  if (!composerText.value.trim() || !patient.value) return
  sendError.value = ''
  sending.value = true
  try {
    await authedFetch('/api/patient-messages/send', { method: 'POST', body: { patientId: patient.value.id, text: composerText.value.trim() } })
    composerText.value = ''
    await load()
  } catch (err: any) {
    sendError.value = err?.data?.statusMessage ?? 'Failed to send'
  } finally {
    sending.value = false
  }
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

let channel: ReturnType<typeof supabase.channel> | null = null
watch(
  patient,
  (p) => {
    if (channel) supabase.removeChannel(channel)
    if (!p) return
    channel = supabase
      .channel(`patient-messages-${p.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_app_messages', filter: `patient_id=eq.${p.id}` }, () => load())
      .subscribe()
  },
  { immediate: true },
)
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" style="padding-bottom: env(safe-area-inset-bottom); padding-top: env(safe-area-inset-top)">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <NuxtLink to="/" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text">&larr;</NuxtLink>
      <p class="text-[15px] font-[600] text-ink-900">Messages</p>
    </div>

    <div v-if="identityLoading || loading" class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="!patient" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      This account isn't linked to a patient record.
    </p>
    <template v-else>
      <div ref="messagesEl" class="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <p v-if="messages.length === 0" class="p-6 text-center text-[13px] text-ink-faint">
          Send a message and the clinic will get back to you here.
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
        <div class="flex items-end gap-2">
          <textarea
            v-model="composerText"
            rows="1"
            placeholder="Type a message…"
            class="max-h-24 min-h-11 flex-1 resize-none rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
            @keydown.enter.exact.prevent="sendText"
          />
          <UiBtn variant="primary" :disabled="sending || !composerText.trim()" @click="sendText">{{ sending ? '…' : 'Send' }}</UiBtn>
        </div>
      </div>
    </template>
  </div>
</template>
