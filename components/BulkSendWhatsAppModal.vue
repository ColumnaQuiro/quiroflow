<script setup lang="ts">
interface Target { patientId: string; firstName: string }
interface Template {
  name: string
  language: string
  category: string
  bodyText: string
  variableCount: number
  mediaHeaderFormat: 'IMAGE' | 'DOCUMENT' | 'VIDEO' | null
}

const props = defineProps<{ targets: Target[]; defaultTemplateName?: string }>()
const emit = defineEmits<{ close: []; sent: [] }>()

const templates = ref<Template[]>([])
const templatesError = ref('')
const loadingTemplates = ref(true)
const selectedTemplateKey = ref('')
// Variable 1 is always each recipient's own first name; any remaining
// variables (e.g. an appointment date) are shared text applied to everyone.
const sharedVariables = ref<string[]>([])

function templateKey(t: Pick<Template, 'name' | 'language'>) {
  return `${t.name}::${t.language}`
}
const selectedTemplate = computed(() => templates.value.find((t) => templateKey(t) === selectedTemplateKey.value) ?? null)

onMounted(async () => {
  try {
    const { templates: list } = await $fetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
    const candidates = list.filter((t) => t.name === props.defaultTemplateName)
    if (candidates[0]) selectTemplate(templateKey(candidates[0]))
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? 'Failed to load WhatsApp templates'
  } finally {
    loadingTemplates.value = false
  }
})

function slot(n: number) {
  return `{{${n}}}`
}

function selectTemplate(key: string) {
  selectedTemplateKey.value = key
  const t = templates.value.find((tpl) => templateKey(tpl) === key)
  const count = t?.variableCount ?? 0
  sharedVariables.value = Array.from({ length: Math.max(count - 1, 0) }, () => '')
}

const sending = ref(false)
const results = ref<{ name: string; ok: boolean; error?: string }[]>([])

async function send() {
  if (!selectedTemplate.value) return
  sending.value = true
  results.value = []
  for (const target of props.targets) {
    const variables = [target.firstName, ...sharedVariables.value]
    try {
      await $fetch('/api/whatsapp/send', {
        method: 'POST',
        body: {
          patientId: target.patientId,
          templateName: selectedTemplate.value.name,
          templateLanguage: selectedTemplate.value.language,
          variables,
          headerFormat: selectedTemplate.value.mediaHeaderFormat ?? undefined,
        },
      })
      results.value.push({ name: target.firstName, ok: true })
    } catch (err: any) {
      results.value.push({ name: target.firstName, ok: false, error: err?.data?.statusMessage ?? 'Failed' })
    }
  }
  sending.value = false
  emit('sent')
}

const sentCount = computed(() => results.value.filter((r) => r.ok).length)
const failedCount = computed(() => results.value.filter((r) => !r.ok).length)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
      <h3 class="text-sm font-semibold text-gray-900">Send WhatsApp to {{ targets.length }} patient{{ targets.length === 1 ? '' : 's' }}</h3>

      <template v-if="results.length === 0">
        <div v-if="loadingTemplates" class="mt-3 text-sm text-gray-400">Loading templates…</div>
        <p v-else-if="templatesError" class="mt-3 text-sm text-red-600">{{ templatesError }}</p>
        <template v-else>
          <div class="mt-3">
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
            <p class="mt-2 text-xs text-gray-400">{{ slot(1) }} is filled with each patient's own first name.</p>

            <div v-if="sharedVariables.length > 0" class="mt-3 space-y-2">
              <div v-for="(v, i) in sharedVariables" :key="i">
                <label class="block text-xs font-medium text-gray-500">{{ slot(i + 2) }} (same for everyone)</label>
                <input
                  v-model="sharedVariables[i]"
                  type="text"
                  class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </template>
        </template>

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
            {{ sending ? `Sending… (${results.length}/${targets.length})` : `Send to ${targets.length}` }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="mt-3 text-sm text-gray-700">
          Sent to {{ sentCount }} patient{{ sentCount === 1 ? '' : 's' }}<span v-if="failedCount > 0">, {{ failedCount }} failed</span>.
        </p>
        <ul v-if="failedCount > 0" class="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-600">
          <li v-for="(r, i) in results.filter((r) => !r.ok)" :key="i">{{ r.name }}: {{ r.error }}</li>
        </ul>
        <div class="mt-4 flex justify-end">
          <button type="button" class="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="emit('close')">
            Done
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
