<script setup lang="ts">
import type { EmailDesign } from '~/utils/emailDesign'
import { AI_EMAIL_MAX_DESCRIPTION } from '~/utils/aiEmailDraft'
import { HINT, LABEL } from '~/utils/automationUi'

// "Write with AI", at the top of the email editor's Templates tab: say what
// the email is for, and the model writes it as this editor's blocks
// (server/api/automations/draft-email.post.ts). What comes back goes through
// the tab's own "replace what it says now?" question, like any template, and
// nothing is saved until the automation is.

const emit = defineEmits<{ drafted: [design: EmailDesign, subject: string] }>()
const t = useT()
const { preference } = useLang()
const b = useBuilder()
const { fields } = useMergeSamples()

const description = ref('')
const busy = ref(false)
const error = ref('')

async function write() {
  if (!description.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<
      | { available: false }
      | { available: true; limit: 'hour' | 'day' }
      | { available: true; refused: true }
      | { available: true; empty: true }
      | { available: true; draft: { subject: string; design: EmailDesign } }
    >('/api/automations/draft-email', {
      method: 'POST',
      body: {
        description: description.value,
        language: preference.value,
        trigger: b.draft.value.rule.trigger_event,
        marketing: !!b.draft.value.rule.is_marketing,
        leadFields: fields.value.filter((f) => f.group === 'lead').map((f) => ({ key: f.key, label: f.label })),
      },
    })
    if (!res.available) error.value = t('Writing with AI is not available right now.', 'Escribir con IA no está disponible ahora mismo.')
    else if ('limit' in res)
      error.value = res.limit === 'hour'
        ? t('Your clinic has written a lot of emails with AI this hour. Try again in a while.', 'Tu clínica ha escrito muchos emails con IA en esta hora. Vuelve a intentarlo dentro de un rato.')
        : t("Your clinic has reached today's limit of AI drafts. Try again tomorrow.", 'Tu clínica ha llegado al límite de borradores con IA de hoy. Vuelve a intentarlo mañana.')
    else if ('refused' in res) error.value = t('The AI would not write this email. Try describing it differently.', 'La IA no ha querido escribir este email. Prueba a describirlo de otra forma.')
    else if ('empty' in res) error.value = t('No email came out of that. Say who it is for and what it should tell them.', 'No ha salido ningún email. Di a quién va y qué tiene que contarle.')
    else emit('drafted', res.draft.design, res.draft.subject)
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? t('Could not write the email. Try again.', 'No se ha podido escribir el email. Vuelve a intentarlo.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle p-2.5" data-test="email-ai-write">
    <label :class="LABEL">
      {{ t('Write with AI', 'Escribir con IA') }}
      <textarea
        v-model="description"
        rows="3"
        :maxlength="AI_EMAIL_MAX_DESCRIPTION"
        :disabled="busy"
        data-test="email-ai-description"
        :placeholder="t('E.g. thank them for their first visit and remind them to book the next one', 'P. ej. agradece su primera visita y recuérdale reservar la siguiente')"
        class="rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[13px] font-normal leading-snug text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60"
      />
    </label>
    <UiBtn size="sm" variant="primary" class="self-start" :disabled="busy || !description.trim()" data-test="email-ai-go" @click="write">
      {{ busy ? t('Writing…', 'Escribiendo…') : t('Write the email', 'Escribir el email') }}
    </UiBtn>
    <p v-if="busy" :class="HINT" role="status">{{ t('This can take up to a minute.', 'Puede tardar hasta un minuto.') }}</p>
    <p v-if="error" class="text-[12.5px] text-danger-text" role="alert" data-test="email-ai-error">{{ error }}</p>
    <p v-if="!busy && !error" :class="HINT">{{ t('Read it before you save: anything in [square brackets] is for you to fill in.', 'Léelo antes de guardar: lo que esté [entre corchetes] es para que lo completes.') }}</p>
  </div>
</template>
