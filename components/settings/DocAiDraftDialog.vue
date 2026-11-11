<script setup lang="ts">
import type { AiFormDraft } from '~/utils/aiFormDraft'
import { AI_FORM_MAX_DESCRIPTION, AI_FORM_MAX_SOURCE } from '~/utils/aiFormDraft'

// Settings > Docs > "Create with AI": describe a form, or paste the one the
// clinic used before, and get it back as a draft in the editor
// (server/api/docs/draft-form.post.ts). Nothing is saved here; the editor's
// Save is what creates the template.

const emit = defineEmits<{ drafted: [AiFormDraft]; cancel: [] }>()
const t = useT()
const { preference } = useLang()

const description = ref('')
const source = ref('')
const pasting = ref(false)
const busy = ref(false)
const error = ref('')

// One click fills the description, for someone looking at an empty box.
const EXAMPLES = computed(() => [
  {
    label: t('Chiropractic intake', 'Anamnesis quiropráctica'),
    text: t(
      'Intake form for a new chiropractic patient: contact details, reason for the visit, where it hurts and since when, pain from 0 to 10, previous injuries and surgery, medication, and how they heard about us.',
      'Formulario de primera visita para un paciente nuevo de quiropráctica: datos de contacto, motivo de consulta, dónde le duele y desde cuándo, dolor de 0 a 10, lesiones y operaciones anteriores, medicación y cómo nos conoció.',
    ),
  },
  {
    label: t('Informed consent', 'Consentimiento informado'),
    text: t(
      'Informed consent for chiropractic adjustments: what the treatment involves, its usual and rare risks, the right to ask questions and to stop at any time, and the patient\'s signature.',
      'Consentimiento informado para ajustes quiroprácticos: en qué consiste el tratamiento, sus riesgos habituales y poco frecuentes, el derecho a preguntar y a interrumpirlo en cualquier momento, y la firma del paciente.',
    ),
  },
  {
    label: t('Satisfaction survey', 'Encuesta de satisfacción'),
    text: t(
      'A short satisfaction survey after a few visits: how they rate the care, whether they have improved, whether they would recommend us, and anything we could do better.',
      'Una encuesta de satisfacción corta tras unas visitas: cómo valoran la atención, si han mejorado, si nos recomendarían y qué podríamos mejorar.',
    ),
  },
])

const ready = computed(() => description.value.trim() !== '' || source.value.trim() !== '')

async function draft() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<
      | { available: false }
      | { available: true; limit: 'hour' | 'day' }
      | { available: true; refused: true }
      | { available: true; empty: true }
      | { available: true; draft: AiFormDraft }
    >('/api/docs/draft-form', {
      method: 'POST',
      body: { description: description.value, source: pasting.value ? source.value : '', language: preference.value },
    })
    if (!res.available) {
      error.value = t('Drafting with AI is not available right now.', 'Crear con IA no está disponible ahora mismo.')
    } else if ('limit' in res) {
      error.value = res.limit === 'hour'
        ? t('Your clinic has drafted a lot of forms this hour. Try again in a while.', 'Tu clínica ha creado muchos formularios en esta hora. Vuelve a intentarlo dentro de un rato.')
        : t('Your clinic has reached today\'s limit of AI drafts. Try again tomorrow.', 'Tu clínica ha llegado al límite de borradores con IA de hoy. Vuelve a intentarlo mañana.')
    } else if ('refused' in res) {
      error.value = t('The AI would not draft this form. Try describing it differently.', 'La IA no ha querido crear este formulario. Prueba a describirlo de otra forma.')
    } else if ('empty' in res) {
      error.value = t('No form came out of that. Say what the form is for and what it should ask.', 'No ha salido ningún formulario. Di para qué es el formulario y qué debe preguntar.')
    } else {
      emit('drafted', res.draft)
    }
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? t('Could not draft the form. Try again.', 'No se ha podido crear el formulario. Vuelve a intentarlo.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('Create a form with AI', 'Crear un formulario con IA')"
    :confirm-label="busy ? t('Drafting…', 'Creando…') : t('Draft the form', 'Crear el borrador')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!ready"
    :busy="busy"
    @confirm="draft"
    @cancel="busy ? undefined : emit('cancel')"
  >
    <div class="flex flex-col gap-3" data-cy="doc-ai-dialog">
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Describe the form, or paste the one you used before. You get a draft to check and edit; nothing is saved until you save it.', 'Describe el formulario, o pega el que usabas antes. Recibirás un borrador para revisar y editar; no se guarda nada hasta que lo guardes.') }}
      </p>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('What should the form be?', '¿Cómo debe ser el formulario?') }}
        <textarea
          v-model="description"
          rows="4"
          :maxlength="AI_FORM_MAX_DESCRIPTION"
          :disabled="busy"
          data-cy="doc-ai-description"
          :placeholder="t('E.g. an intake form for new patients with back pain…', 'P. ej. un formulario de primera visita para pacientes con dolor de espalda…')"
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
      <button
        v-if="!pasting"
        type="button"
        class="self-start text-[13.5px] font-semibold text-brand-text hover:underline"
        data-cy="doc-ai-paste-toggle"
        :disabled="busy"
        @click="pasting = true"
      >
        + {{ t('Paste a form from your previous software', 'Pegar un formulario de tu programa anterior') }}
      </button>
      <label v-else class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Your current form', 'Tu formulario actual') }}
        <textarea
          v-model="source"
          rows="7"
          :maxlength="AI_FORM_MAX_SOURCE"
          :disabled="busy"
          data-cy="doc-ai-source"
          :placeholder="t('Paste the questions and text of the blank form here.', 'Pega aquí las preguntas y el texto del formulario en blanco.')"
          class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-snug text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60"
        />
        <span class="text-[12.5px] font-normal text-ink-muted">{{ t('Paste a blank form, never one a patient has filled in.', 'Pega un formulario en blanco, nunca uno que haya rellenado un paciente.') }}</span>
      </label>
      <p v-if="busy" class="text-[13px] text-ink-muted" role="status">{{ t('This can take up to a minute.', 'Puede tardar hasta un minuto.') }}</p>
      <p v-if="error" class="text-[13.5px] text-danger-text" role="alert" data-cy="doc-ai-error">{{ error }}</p>
    </div>
  </UiConfirmDialog>
</template>
