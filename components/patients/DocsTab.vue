<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import type { DocField } from '~/utils/docFields'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

// `public_token` isn't in the generated Supabase types yet -- merge it in
// locally rather than editing the generated file by hand.
type Doc = Omit<Tables<'patient_docs'>, 'fields'> & { fields: DocField[]; public_token: string }
type Template = Omit<Tables<'doc_templates'>, 'fields'> & { fields: DocField[] }

const docs = ref<Doc[]>([])
const templates = ref<Template[]>([])
const loading = ref(true)
const activeDoc = ref<Doc | null>(null)
const title = ref('')
const fields = ref<DocField[]>([])
const saving = ref(false)
const savedAt = ref<Date | null>(null)
const showNewMenu = ref(false)
const patientPhoneDigits = ref<string | null>(null)
const copiedId = ref<string | null>(null)

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

onMounted(async () => {
  const { data } = await supabase
    .from('patient_contact_numbers')
    .select('country_code, number')
    .eq('patient_id', props.patientId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (data) patientPhoneDigits.value = `${countryByCode(data.country_code).dial}${data.number}`.replace(/\D/g, '')
})

function docLink(doc: Doc) {
  return `${window.location.origin}/doc/${doc.public_token}`
}
function openLink(doc: Doc) {
  window.open(docLink(doc), '_blank')
}
async function copyLink(doc: Doc) {
  await navigator.clipboard.writeText(docLink(doc))
  copiedId.value = doc.id
  setTimeout(() => {
    if (copiedId.value === doc.id) copiedId.value = null
  }, 2000)
}
function sendViaWhatsApp(doc: Doc) {
  if (!patientPhoneDigits.value) return
  const message = `Hi! Please complete this document: ${docLink(doc)}`
  window.open(`https://wa.me/${patientPhoneDigits.value}?text=${encodeURIComponent(message)}`, '_blank')
}

function openDoc(doc: Doc) {
  activeDoc.value = doc
  title.value = doc.title
  fields.value = Array.isArray(doc.fields) ? [...doc.fields] : []
  savedAt.value = null
}

async function createDoc(initialTitle: string, initialFields: DocField[], templateId: string | null = null) {
  const { data, error } = await supabase
    .from('patient_docs')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      title: initialTitle,
      fields: initialFields as any,
      template_id: templateId,
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
  await createDoc('Untitled', [])
}

async function newFromTemplate(template: Template) {
  showNewMenu.value = false
  const { data: patient } = await supabase
    .from('patients')
    .select('first_name, last_name, date_of_birth, email')
    .eq('id', props.patientId)
    .maybeSingle()
  const rendered = renderTemplateFields(template.fields, {
    first_name: patient?.first_name ?? '',
    last_name: patient?.last_name ?? '',
    date_of_birth: patient?.date_of_birth ?? '',
    email: patient?.email ?? '',
    clinic_name: store.accountName,
    today: new Date().toLocaleDateString(),
  })
  await createDoc(template.title, rendered, template.id)
}

function backToList() {
  activeDoc.value = null
  load()
}

async function save() {
  if (!activeDoc.value) return
  saving.value = true
  const { error } = await supabase
    .from('patient_docs')
    .update({ title: title.value.trim() || 'Untitled', fields: fields.value as any, updated_by: store.teamMember?.id ?? null })
    .eq('id', activeDoc.value.id)
  saving.value = false
  if (!error) savedAt.value = new Date()
}

async function toggleComplete() {
  if (!activeDoc.value) return
  const newCompletedAt = activeDoc.value.completed_at ? null : new Date().toISOString()
  const { error } = await supabase.from('patient_docs').update({ completed_at: newCompletedAt }).eq('id', activeDoc.value.id)
  if (!error) {
    activeDoc.value = { ...activeDoc.value, completed_at: newCompletedAt }
    docs.value = docs.value.map((d) => (d.id === activeDoc.value!.id ? { ...d, completed_at: newCompletedAt } : d))
  }
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
            <span v-if="doc.completed_at" class="ml-1.5 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">Completed</span>
          </button>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">{{ new Date(doc.updated_at).toLocaleString() }}</span>
            <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-500" title="Open patient link in a new tab" @click="openLink(doc)">
              Open link
            </button>
            <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-500" title="Copy patient link" @click="copyLink(doc)">
              {{ copiedId === doc.id ? 'Copied!' : 'Copy link' }}
            </button>
            <button
              v-if="patientPhoneDigits"
              type="button"
              class="text-xs font-medium text-green-600 hover:text-green-500"
              title="Send patient link via WhatsApp"
              @click="sendViaWhatsApp(doc)"
            >
              WhatsApp
            </button>
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
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium"
            :class="activeDoc?.completed_at ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="toggleComplete"
          >
            {{ activeDoc?.completed_at ? '✓ Completed' : 'Mark as completed' }}
          </button>
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
          class="mb-4 w-full border-none text-xl font-semibold text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-0"
        />
        <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
      </div>
    </template>
  </div>
</template>
