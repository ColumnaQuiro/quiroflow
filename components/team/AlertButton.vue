<script setup lang="ts">
// "I need help in here": one button in the top bar, on every screen, for a
// team member who feels unsafe with a patient or needs a hand at once. Asked
// for on PracticeHub's community as a panic button in the treatment rooms.
//
// Two clicks, not one -- the first opens this, the second sends -- because a
// false alarm pulls the whole team out of their rooms. It goes to everyone,
// on every open screen (TeamAlertBanner) and as a push that ignores quiet
// hours (server/api/team-messages/send.post.ts).
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { raiseAlert } = useTeamChat()
const { showToast } = useToast()

const open = ref(false)
const rooms = ref<{ id: string; name: string }[]>([])
const roomId = ref<string>('')
const note = ref('')
const sending = ref(false)
// Server-rendered, so a click before hydration would do nothing at all --
// and a person in trouble pressing it twice must not get nothing.
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))

watch(open, async (isOpen) => {
  if (!isOpen || !store.currentClinicId) return
  const { data } = await supabase.from('calendar_resources').select('id, name').eq('clinic_id', store.currentClinicId).order('name')
  rooms.value = data ?? []
})

async function send() {
  sending.value = true
  try {
    await raiseAlert(note.value.trim() || t('I need help', 'Necesito ayuda'), roomId.value || null)
    open.value = false
    note.value = ''
    showToast(t('The team has been alerted.', 'Se ha avisado al equipo.'))
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('The alert could not be sent. Call out or phone the desk.', 'No se pudo enviar el aviso. Llama en voz alta o a recepción.'), 'error')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex h-7 items-center gap-1.5 rounded-ctl border border-danger-border bg-surface px-2 text-[12.5px] font-semibold text-danger-text hover:bg-danger-bg touch:h-11"
      data-cy="team-alert-open"
      :disabled="!hydrated"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 1.5 13.5h13z" /><path d="M8 6.2v3.4M8 11.6v.1" /></svg>
      <span class="hidden sm:inline">{{ t('Help', 'Ayuda') }}</span>
    </button>
    <div v-if="open" class="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-card border border-line bg-surface p-3 shadow-popover" data-cy="team-alert-panel">
      <p class="text-[14px] font-bold text-ink-900">{{ t('Alert the team', 'Avisar al equipo') }}</p>
      <p class="mt-1 text-[12.5px] text-ink-muted">{{ t('Everyone on shift sees it on screen and on their phone, until someone answers.', 'Todo el equipo lo ve en pantalla y en el móvil hasta que alguien responda.') }}</p>
      <label v-if="rooms.length" class="mt-3 flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
        {{ t('Where', 'Dónde') }}
        <select v-model="roomId" data-cy="team-alert-room" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13.5px] text-ink-900">
          <option value="">{{ t('Not a room', 'Sin sala') }}</option>
          <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <input v-model="note" maxlength="200" data-cy="team-alert-note" :placeholder="t('I need help (optional detail)', 'Necesito ayuda (detalle opcional)')" class="mt-2 h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none" />
      <div class="mt-3 flex gap-2">
        <button type="button" data-cy="team-alert-send" :disabled="sending" class="h-9 flex-1 rounded-ctl bg-danger-text px-3 text-[13.5px] font-bold text-surface hover:opacity-90 disabled:opacity-60" @click="send">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send alert', 'Enviar aviso') }}
        </button>
        <button type="button" class="h-9 rounded-ctl px-3 text-[13px] font-semibold text-ink-muted hover:bg-surface-subtle" @click="open = false">{{ t('Cancel', 'Cancelar') }}</button>
      </div>
    </div>
  </div>
</template>
