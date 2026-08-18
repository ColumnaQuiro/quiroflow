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
    const { templates: list } = await $fetch<{ templates: Template[] }>('/api/whatsapp/templates')
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
    templatesError.value = err?.data?.statusMessage ?? 'Failed to load WhatsApp templates'
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
    await $fetch('/api/whatsapp/send', {
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
    error.value = err?.data?.statusMessage ?? 'Failed to send'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
      <h3 class="text-sm font-semibold text-gray-900">Send WhatsApp message</h3>

      <div v-if="loadingTemplates" class="mt-3 text-sm text-gray-400">Loading templates…</div>
      <p v-else-if="templatesError" class="mt-3 text-sm text-red-600">{{ templatesError }}</p>
      <p v-else-if="!allowTemplateOverride && !selectedTemplate" class="mt-3 text-sm text-red-600">
        No default template is configured. Set one in Settings &gt; WhatsApp.
      </p>
      <template v-else>
        <div v-if="allowTemplateOverride" class="mt-3">
          <label class="block text-xs font-medium text-gray-500">Template</label>
          <select
            :value="selectedTemplateKey"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            @change="selectTemplate(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Choose a template…</option>
            <option v-for="t in templates" :key="templateKey(t)" :value="templateKey(t)">{{ t.name }} ({{ t.language }})</option>
          </select>
        </div>

        <template v-if="selectedTemplate">
          <p class="mt-3 whitespace-pre-wrap rounded-md bg-gray-50 p-2.5 text-xs text-gray-500">{{ selectedTemplate.bodyText }}</p>

          <div v-if="variables.length > 0" class="mt-3 space-y-2">
            <div v-for="(v, i) in variables" :key="i">
              <label class="block text-xs font-medium text-gray-500">{{ slot(i + 1) }}</label>
              <input
                v-model="variables[i]"
                type="text"
                class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div v-if="selectedTemplate.mediaHeaderFormat" class="mt-3">
            <label class="block text-xs font-medium text-gray-500">Attach {{ selectedTemplate.mediaHeaderFormat.toLowerCase() }} (required by template)</label>
            <select v-model="attachmentFileId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm">
              <option value="">No attachment</option>
              <option v-for="f in files" :key="f.id" :value="f.id">{{ f.file_name }}</option>
            </select>
          </div>
        </template>
      </template>

      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="emit('close')">
          Cancel
        </button>
        <button
          type="button"
          :disabled="sending || !selectedTemplate"
          class="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          @click="send"
        >
          {{ sending ? 'Sending…' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>
