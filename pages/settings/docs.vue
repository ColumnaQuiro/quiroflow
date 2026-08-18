<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// content narrowed away from Supabase's recursive Json type -- combined
// with Vue's ref/UnwrapRef machinery it blows up the type checker (same
// issue hit with patient_docs and clinics.business_hours).
type Template = Omit<Tables<'doc_templates'>, 'content'> & { content: unknown }

const supabase = useSupabaseClient()
const store = useAccountStore()

const templates = ref<Template[]>([])
const loading = ref(true)
const activeTemplate = ref<Template | null>(null)
const title = ref('')
const saving = ref(false)
const savedAt = ref<Date | null>(null)
const editorRef = ref<{ setContent: (json: unknown) => void; getJSON: () => unknown; insertText: (text: string) => void }>()

async function load() {
  loading.value = true
  const { data } = await supabase.from('doc_templates').select('*').order('updated_at', { ascending: false })
  templates.value = (data as unknown as Template[]) ?? []
  loading.value = false
}
onMounted(load)

function openTemplate(t: Template) {
  activeTemplate.value = t
  title.value = t.title
  savedAt.value = null
  nextTick(() => editorRef.value?.setContent(t.content))
}

async function newTemplate() {
  const { data, error } = await supabase
    .from('doc_templates')
    .insert({
      account_id: store.accountId!,
      title: 'Untitled template',
      content: {},
      created_by: store.teamMember?.id ?? null,
      updated_by: store.teamMember?.id ?? null,
    })
    .select('*')
    .single()
  if (error || !data) return
  const created = data as unknown as Template
  templates.value = [created, ...templates.value]
  openTemplate(created)
}

function backToList() {
  activeTemplate.value = null
  load()
}

async function save() {
  if (!activeTemplate.value || !editorRef.value) return
  saving.value = true
  const content = editorRef.value.getJSON() as any
  const { error } = await supabase
    .from('doc_templates')
    .update({ title: title.value.trim() || 'Untitled template', content, updated_by: store.teamMember?.id ?? null })
    .eq('id', activeTemplate.value.id)
  saving.value = false
  if (!error) savedAt.value = new Date()
}

async function removeTemplate(t: Template) {
  if (!confirm(`Delete "${t.title}"?`)) return
  await supabase.from('doc_templates').delete().eq('id', t.id)
  templates.value = templates.value.filter((x) => x.id !== t.id)
  if (activeTemplate.value?.id === t.id) activeTemplate.value = null
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Docs</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      Reusable document templates — write something once (e.g. a data protection consent form) and generate a
      filled-in copy for each patient from their Docs tab.
    </p>

    <div class="mt-6 rounded-lg border border-gray-200 bg-white">
      <template v-if="!activeTemplate">
        <div class="flex items-center justify-between border-b border-gray-100 p-4">
          <h3 class="text-sm font-semibold text-gray-900">Templates</h3>
          <button type="button" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="newTemplate">
            + New Template
          </button>
        </div>
        <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
        <div v-else-if="templates.length === 0" class="p-8 text-center text-sm text-gray-400">No templates yet.</div>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="t in templates" :key="t.id" class="flex items-center justify-between px-4 py-3">
            <button type="button" class="text-left text-sm font-medium text-gray-900 hover:text-indigo-600" @click="openTemplate(t)">
              {{ t.title }}
            </button>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400">{{ new Date(t.updated_at).toLocaleString() }}</span>
              <button type="button" class="text-xs text-red-600 hover:text-red-700" @click="removeTemplate(t)">Delete</button>
            </div>
          </li>
        </ul>
      </template>

      <template v-else>
        <div class="flex items-center justify-between border-b border-gray-100 p-4">
          <button type="button" class="text-sm text-gray-500 hover:text-gray-700" @click="backToList">&larr; Templates</button>
          <div class="flex items-center gap-3">
            <span v-if="savedAt" class="text-xs text-green-600">Saved</span>
            <button type="button" :disabled="saving" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" @click="save">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>

        <div class="p-4">
          <input
            v-model="title"
            type="text"
            placeholder="Untitled template"
            class="w-full border-none text-xl font-semibold text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-0"
          />

          <RichTextEditor ref="editorRef" placeholder="Write the template… use Insert field to add patient placeholders">
            <template #extra-toolbar="{ insertText }">
              <span class="mx-1 h-4 w-px bg-gray-200"></span>
              <select
                class="rounded border-none bg-transparent px-2 py-1 text-sm text-indigo-600 hover:bg-gray-100 focus:outline-none"
                @change="
                  (e) => {
                    const v = (e.target as HTMLSelectElement).value
                    if (v) insertText(`{{${v}}}`)
                    ;(e.target as HTMLSelectElement).value = ''
                  }
                "
              >
                <option value="">+ Insert field</option>
                <option v-for="f in DOC_TEMPLATE_FIELDS" :key="f.key" :value="f.key">{{ f.label }}</option>
              </select>
            </template>
          </RichTextEditor>
        </div>
      </template>
    </div>
  </div>
</template>
