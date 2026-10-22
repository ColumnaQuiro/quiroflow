<script setup lang="ts">
// "I need help in here", from the phone: the web's top-bar button
// (components/team/AlertButton.vue) as a bottom sheet. Opening it is the
// first tap and Send the second -- a false alarm pulls the whole team out of
// their rooms -- and it goes to everyone, on every open screen and as a push
// that ignores quiet hours (server/api/team-messages/send.post.ts).
const emit = defineEmits<{ close: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const { context } = usePractitionerContext()
const { raiseAlert } = useStaffTeamChat()

const rooms = ref<{ id: string; name: string }[]>([])
const roomId = ref('')
const note = ref('')
const sending = ref(false)
const error = ref('')

onMounted(async () => {
  if (!context.value?.clinicId) return
  const { data } = await supabase.from('calendar_resources').select('id, name').eq('clinic_id', context.value.clinicId).order('name')
  rooms.value = (data as { id: string; name: string }[] | null) ?? []
})

async function send() {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    await raiseAlert(note.value.trim() || t('I need help', 'Necesito ayuda'), roomId.value || null, context.value?.clinicId ?? null)
    emit('close')
  } catch (e: unknown) {
    error.value = (e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('The alert could not be sent. Call out or phone the desk.', 'No se pudo enviar el aviso. Llama en voz alta o a recepción.')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="team-alert-sheet" @click.self="emit('close')">
    <div
      v-sheet-drag="() => emit('close')"
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Alert the team', 'Avisar al equipo')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <div>
        <p class="text-[17px] font-semibold text-ink-900">{{ t('Alert the team', 'Avisar al equipo') }}</p>
        <p class="mt-1 text-[13px] text-ink-muted">{{ t('Everyone on shift sees it on screen and on their phone, until someone answers.', 'Todo el equipo lo ve en pantalla y en el móvil hasta que alguien responda.') }}</p>
      </div>

      <fieldset v-if="rooms.length" class="flex flex-col gap-2" data-cy="team-alert-rooms">
        <legend class="mb-1.5 text-[13.5px] font-semibold text-ink-900">{{ t('Where', 'Dónde') }}</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="r in [{ id: '', name: t('Not a room', 'Sin sala') }, ...rooms]"
            :key="r.id"
            type="button"
            class="h-11 rounded-pill px-4 text-[14px] font-medium"
            :class="roomId === r.id ? 'border-[1.5px] border-brand bg-brand-tint text-brand-text' : 'border border-line-control bg-surface text-ink-700'"
            :aria-pressed="roomId === r.id"
            data-cy="team-alert-room"
            @click="roomId = r.id"
          >
            {{ r.name }}
          </button>
        </div>
      </fieldset>

      <input
        v-model="note"
        maxlength="200"
        enterkeyhint="send"
        :placeholder="t('I need help (optional detail)', 'Necesito ayuda (detalle opcional)')"
        class="h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none"
        data-cy="team-alert-note"
        @keydown.enter.prevent="send"
      />

      <p v-if="error" class="rounded-ctl border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-text" role="alert">{{ error }}</p>

      <button
        type="button"
        class="h-12 w-full rounded-ctl bg-danger-text text-[15px] font-bold text-white active:opacity-80 disabled:opacity-60"
        :disabled="sending"
        data-cy="team-alert-send"
        @click="send"
      >
        {{ sending ? t('Sending…', 'Enviando…') : t('Send alert', 'Enviar aviso') }}
      </button>
      <button type="button" class="h-11 w-full rounded-ctl text-[14px] font-semibold text-ink-muted active:bg-surface-subtle" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </div>
  </div>
</template>
