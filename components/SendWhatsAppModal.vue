<script setup lang="ts">
import type { Tables } from '~/types/database.types'

interface Template {
  name: string
  language: string
  category: string
  bodyText: string
  variableCount: number
  mediaHeaderFormat: 'IMAGE' | 'DOCUMENT' | 'VIDEO' | null
}

const props = withDefaults(
  defineProps<{
    patientId: string
    patientFirstName?: string
    patientPreferredLanguage?: string
    appointmentId?: string
    defaultTemplateName?: string
    autofill?: Record<string, string>
    allowTemplateOverride?: boolean
  }>(),
  { allowTemplateOverride: true },
)

const emit = defineEmits<{ close: []; sent: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const templates = ref<Template[]>([])
const templatesError = ref('')
const loadingTemplates = ref(true)
const selectedTemplateKey = ref('')
const variables = ref<string[]>([])
const files = ref<Tables<'patient_files'>[]>([])
const attachmentFileId = ref('')
const sending = ref(false)
const error = ref('')

// Template name alone isn't unique -- the same name can have multiple
// approved language variants (e.g. "appointment_reminder" in es/en/fr) --
// so options are keyed by name+language, not name alone.
function templateKey(t: Pick<Template, 'name' | 'language'>) {
  return `${t.name}::${t.language}`
}

const selectedTemplate = computed(() => templates.value.find((t) => templateKey(t) === selectedTemplateKey.value) ?? null)

onMounted(async () => {
  try {
    const { templates: list } = await useStaffFetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
    const candidates = list.filter((t) => t.name === props.defaultTemplateName)
    // Prefer the variant matching the patient's own communication language,
    // falling back to whatever approved variant exists otherwise.
    const defaultMatch =
      candidates.find((t) => t.language === props.patientPreferredLanguage) ??
      candidates.find((t) => t.language.split('_')[0] === props.patientPreferredLanguage) ??
      candidates[0]
    if (defaultMatch) selectTemplate(templateKey(defaultMatch))
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? t('Failed to load WhatsApp templates', 'No se han podido cargar las plantillas de WhatsApp')
  } finally {
    loadingTemplates.value = false
  }

  const { data } = await supabase.from('patient_files').select('*').eq('patient_id', props.patientId).order('created_at', { ascending: false })
  files.value = data ?? []
})

function slot(n: number) {
  return `{{${n}}}`
}

function selectTemplate(key: string) {
  selectedTemplateKey.value = key
  const t = templates.value.find((tpl) => templateKey(tpl) === key)
  const count = t?.variableCount ?? 0
  const guesses = [props.patientFirstName ?? '', ...(props.autofill ? Object.values(props.autofill) : [])]
  variables.value = Array.from({ length: count }, (_, i) => guesses[i] ?? '')
  attachmentFileId.value = ''
}

async function send() {
  error.value = ''
  if (!selectedTemplate.value) return
  sending.value = true
  try {
    await useStaffFetch('/api/whatsapp/send', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        templateName: selectedTemplate.value.name,
        templateLanguage: selectedTemplate.value.language,
        variables: variables.value,
        headerFormat: selectedTemplate.value.mediaHeaderFormat ?? undefined,
        attachmentFileId: attachmentFileId.value || undefined,
        appointmentId: props.appointmentId,
      },
    })
    emit('sent')
    emit('close')
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? t('Failed to send', 'No se ha podido enviar')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-popover">
      <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Send WhatsApp message', 'Enviar mensaje de WhatsApp') }}</h3>

      <div v-if="loadingTemplates" class="mt-3 text-[13px] text-ink-faint">{{ t('Loading templates…', 'Cargando plantillas…') }}</div>
      <p v-else-if="templatesError" class="mt-3 text-[13px] text-danger-text">{{ templatesError }}</p>
      <p v-else-if="!allowTemplateOverride && !selectedTemplate" class="mt-3 text-[13px] text-danger-text">
        {{ t('No default template is configured. Set one in Settings > WhatsApp.', 'No hay ninguna plantilla predeterminada configurada. Configura una en Ajustes > WhatsApp.') }}
      </p>
      <template v-else>
        <div v-if="allowTemplateOverride" class="mt-3">
          <label class="block text-xs font-medium text-ink-muted">{{ t('Template', 'Plantilla') }}</label>
          <select
            :value="selectedTemplateKey"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
            @change="selectTemplate(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>{{ t('Choose a template…', 'Elige una plantilla…') }}</option>
            <option v-for="tpl in templates" :key="templateKey(tpl)" :value="templateKey(tpl)">{{ tpl.name }} ({{ tpl.language }})</option>
          </select>
        </div>

        <template v-if="selectedTemplate">
          <p class="mt-3 whitespace-pre-wrap rounded-ctl bg-surface-subtle p-2.5 text-xs text-ink-muted2">{{ selectedTemplate.bodyText }}</p>

          <div v-if="variables.length > 0" class="mt-3 space-y-2">
            <div v-for="(v, i) in variables" :key="i">
              <label class="block text-xs font-medium text-ink-muted">{{ slot(i + 1) }}</label>
              <input
                v-model="variables[i]"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
          </div>

          <div v-if="selectedTemplate.mediaHeaderFormat" class="mt-3">
            <label class="block text-xs font-medium text-ink-muted">{{ t('Attach', 'Adjuntar') }} {{ selectedTemplate.mediaHeaderFormat.toLowerCase() }} {{ t('(required by template)', '(requerido por la plantilla)') }}</label>
            <select v-model="attachmentFileId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
              <option value="">{{ t('No attachment', 'Sin adjunto') }}</option>
              <option v-for="f in files" :key="f.id" :value="f.id">{{ f.file_name }}</option>
            </select>
          </div>
        </template>
      </template>

      <p v-if="error" class="mt-2 text-[13px] text-danger-text">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <UiBtn type="button" variant="secondary" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn type="button" variant="primary" :disabled="sending || !selectedTemplate" @click="send">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
