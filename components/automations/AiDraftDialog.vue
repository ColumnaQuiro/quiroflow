<script setup lang="ts">
import type { AiAutomationDraft } from '~/utils/aiAutomationDraft'
import { AI_AUTOMATION_MAX_DESCRIPTION } from '~/utils/aiAutomationDraft'

// The Automations page's "Create with AI": say what should happen and when,
// and the model drafts the automation (server/api/automations/draft-automation.post.ts).
// The draft opens in the builder unsaved and switched off; nothing is saved
// here.

const emit = defineEmits<{ cancel: [] }>()
const t = useT()
const { preference } = useLang()
const router = useRouter()
const handOver = useAiAutomationDraft()

const description = ref('')
const busy = ref(false)
const error = ref('')

const EXAMPLES = computed(() => [
  {
    label: t('Check-up reminder', 'Recordatorio de revisión'),
    text: t(
      'Three months after a completed visit, if they have nothing booked, send an email reminding them it is time for a check-up with a button to book. If they still have not booked a week later, send a second, shorter email.',
      'A los tres meses de una visita completada, si no tiene nada reservado, enviar un email recordándole que le toca revisión con un botón para reservar. Si una semana después sigue sin reservar, un segundo email más corto.',
    ),
  },
  {
    label: t('After the first visit', 'Tras la primera visita'),
    text: t(
      'When a patient completes their first visit, wait two hours and send an email thanking them, explaining what to expect in the next days and inviting them to book their next session.',
      'Cuando un paciente completa su primera visita, esperar dos horas y enviar un email dándole las gracias, explicando qué notará los próximos días e invitándole a reservar la siguiente sesión.',
    ),
  },
  {
    label: t('Missed appointment', 'Cita perdida'),
    text: t(
      'When someone does not attend, send an email the same day saying we missed them and offering to book another time, and notify their practitioner.',
      'Cuando alguien no acude a su cita, enviarle un email ese mismo día diciendo que le echamos de menos y ofreciendo reservar otra hora, y avisar a su profesional.',
    ),
  },
])

async function draft() {
  if (!description.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<
      | { available: false }
      | { available: true; limit: 'hour' | 'day' }
      | { available: true; refused: true }
      | { available: true; empty: true }
      | { available: true; draft: AiAutomationDraft }
    >('/api/automations/draft-automation', { method: 'POST', body: { description: description.value, language: preference.value } })
    if (!res.available) error.value = t('Creating with AI is not available right now.', 'Crear con IA no está disponible ahora mismo.')
    else if ('limit' in res)
      error.value = res.limit === 'hour'
        ? t('Your clinic has drafted a lot of automations this hour. Try again in a while.', 'Tu clínica ha creado muchas automatizaciones en esta hora. Vuelve a intentarlo dentro de un rato.')
        : t("Your clinic has reached today's limit of AI drafts. Try again tomorrow.", 'Tu clínica ha llegado al límite de borradores con IA de hoy. Vuelve a intentarlo mañana.')
    else if ('refused' in res) error.value = t('The AI would not draft this automation. Try describing it differently.', 'La IA no ha querido crear esta automatización. Prueba a describirla de otra forma.')
    else if ('empty' in res) error.value = t('No automation came out of that. Say what should start it and what should happen.', 'No ha salido ninguna automatización. Di qué la inicia y qué debe pasar.')
    else {
      handOver.value = res.draft
      await router.push('/automations/new?from=ai')
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? t('Could not draft the automation. Try again.', 'No se ha podido crear la automatización. Vuelve a intentarlo.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('Create an automation with AI', 'Crear una automatización con IA')"
    :confirm-label="busy ? t('Drafting…', 'Creando…') : t('Draft it', 'Crear el borrador')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!description.trim()"
    :busy="busy"
    @confirm="draft"
    @cancel="busy ? undefined : emit('cancel')"
  >
    <div class="flex flex-col gap-3" data-test="automation-ai-dialog">
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Say what should start it and what should happen. It opens in the builder switched off, for you to check and complete; nothing is sent until you switch it on.', 'Di qué la inicia y qué debe pasar. Se abre en el editor desactivada, para que la revises y la completes; no se envía nada hasta que la actives.') }}
      </p>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('What should it do?', '¿Qué debe hacer?') }}
        <textarea
          v-model="description"
          rows="5"
          :maxlength="AI_AUTOMATION_MAX_DESCRIPTION"
          :disabled="busy"
          data-test="automation-ai-description"
          :placeholder="t('E.g. two days after a visit, ask happy patients for a Google review…', 'P. ej. dos días después de una visita, pedir una reseña en Google…')"
          class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-snug text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60"
        />
      </label>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="ex in EXAMPLES"
          :key="ex.label"
          type="button"
          :disabled="busy"
          class="rounded-pill border border-line-control px-3 py-1 text-[13px] font-semibold text-ink-700 hover:border-brand hover:text-brand-text disabled:opacity-60"
          @click="description = ex.text"
        >
          {{ ex.label }}
        </button>
      </div>
      <p class="text-[12.5px] leading-snug text-ink-muted">
        {{ t('It uses your approved WhatsApp templates and writes emails. Appointment types, forms and lists are for you to choose afterwards.', 'Usa tus plantillas de WhatsApp aprobadas y escribe emails. Los tipos de cita, formularios y listas los eliges tú después.') }}
      </p>
      <p v-if="busy" class="text-[13px] text-ink-muted" role="status">{{ t('This can take up to a minute.', 'Puede tardar hasta un minuto.') }}</p>
      <p v-if="error" class="text-[13.5px] text-danger-text" role="alert" data-test="automation-ai-error">{{ error }}</p>
    </div>
  </UiConfirmDialog>
</template>
