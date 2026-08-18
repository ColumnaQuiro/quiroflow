<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

// content narrowed away from Supabase's recursive Json type -- combined
// with Vue's ref/UnwrapRef machinery it blows up the type checker (same
// issue hit with clinics.business_hours).
type Doc = Omit<Tables<'patient_docs'>, 'content'> & { content: unknown }
type Template = Omit<Tables<'doc_templates'>, 'content'> & { content: unknown }

const docs = ref<Doc[]>([])
const templates = ref<Template[]>([])
const loading = ref(true)
const activeDoc = ref<Doc | null>(null)
const title = ref('')
const saving = ref(false)
const savedAt = ref<Date | null>(null)
const showNewMenu = ref(false)
const editorRef = ref<{ setContent: (json: unknown) => void; getJSON: () => unknown; insertText: (text: string) => void }>()

async function load() {
  loading.value = true
  const [{ data: docData }, { data: templateData }] = await Promise.all([
    supabase.from('patient_docs').select('*').eq('patient_id', props.patientId).order('updated_at', { ascending: false }),
    supabase.from('doc_templates').select('*').order('title'),
  ])
  docs.value = (docData as unknown as Doc[]) ?? []
  templates.value = (templateData as unknown as Template[]) ?? []
  loading.value = false
}
onMounted(load)

function openDoc(doc: Doc) {
  activeDoc.value = doc
  title.value = doc.title
  savedAt.value = null
  nextTick(() => editorRef.value?.setContent(doc.content))
}

async function createDoc(initialTitle: string, initialContent: unknown) {
  const { data, error } = await supabase
    .from('patient_docs')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      title: initialTitle,
      content: initialContent as any,
      created_by: store.teamMember?.id ?? null,
      updated_by: store.teamMember?.id ?? null,
    })
    .select('*')
    .single()
  if (error || !data) return
  const created = data as unknown as Doc
  docs.value = [created, ...docs.value]
  openDoc(created)
}

async function newBlankDoc() {
  showNewMenu.value = false
  await createDoc('Untitled', {})
}

async function newFromTemplate(template: Template) {
  showNewMenu.value = false
  const { data: patient } = await supabase
    .from('patients')
    .select('first_name, last_name, date_of_birth, email')
    .eq('id', props.patientId)
    .maybeSingle()
  const rendered = renderDocTemplate(template.content, {
    first_name: patient?.first_name ?? '',
    last_name: patient?.last_name ?? '',
    date_of_birth: patient?.date_of_birth ?? '',
    email: patient?.email ?? '',
    clinic_name: store.accountName,
    today: new Date().toLocaleDateString(),
  })
  await createDoc(template.title, rendered)
}

function backToList() {
  activeDoc.value = null
  load()
}

async function save() {
  if (!activeDoc.value || !editorRef.value) return
  saving.value = true
  const content = editorRef.value.getJSON() as any
  const { error } = await supabase
    .from('patient_docs')
    .update({ title: title.value.trim() || 'Untitled', content, updated_by: store.teamMember?.id ?? null })
    .eq('id', activeDoc.value.id)
  saving.value = false
  if (!error) savedAt.value = new Date()
}

async function removeDoc(doc: Doc) {
  if (!confirm(`Delete "${doc.title}"?`)) return
  await supabase.from('patient_docs').delete().eq('id', doc.id)
  docs.value = docs.value.filter((d) => d.id !== doc.id)
  if (activeDoc.value?.id === doc.id) activeDoc.value = null
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <template v-if="!activeDoc">
      <div class="flex items-center justify-between border-b border-gray-100 p-4">
        <h3 class="text-sm font-semibold text-gray-900">Docs</h3>
        <div class="relative">
          <button type="button" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" @click="showNewMenu = !showNewMenu">
            + New Doc
          </button>
          <div v-if="showNewMenu" class="absolute right-0 z-10 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            <button type="button" class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50" @click="newBlankDoc">
              Blank document
            </button>
            <template v-if="templates.length > 0">
              <p class="mt-1 border-t border-gray-100 px-3 pt-1.5 text-xs font-medium uppercase text-gray-400">From template</p>
              <button
                v-for="t in templates"
                :key="t.id"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                @click="newFromTemplate(t)"
              >
                {{ t.title }}
              </button>
            </template>
          </div>
        </div>
      </div>
      <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
      <div v-else-if="docs.length === 0" class="p-8 text-center text-sm text-gray-400">
        No docs yet — e.g. a data protection consent record for this patient.
      </div>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="doc in docs" :key="doc.id" class="flex items-center justify-between px-4 py-3">
          <button type="button" class="text-left text-sm font-medium text-gray-900 hover:text-indigo-600" @click="openDoc(doc)">
            {{ doc.title }}
          </button>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">{{ new Date(doc.updated_at).toLocaleString() }}</span>
            <button type="button" class="text-xs text-red-600 hover:text-red-700" @click="removeDoc(doc)">Delete</button>
          </div>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex items-center justify-between border-b border-gray-100 p-4">
        <button type="button" class="text-sm text-gray-500 hover:text-gray-700" @click="backToList">&larr; Docs</button>
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
          placeholder="Untitled"
          class="w-full border-none text-xl font-semibold text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-0"
        />
        <RichTextEditor ref="editorRef" />
      </div>
    </template>
  </div>
</template>
