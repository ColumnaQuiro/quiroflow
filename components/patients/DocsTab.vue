<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import type { DocField } from '~/utils/docFields'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

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
  const message = `${t('Hi! Please complete this document:', '¡Hola! Por favor completa este documento:')} ${docLink(doc)}`
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
  await createDoc(t('Untitled', 'Sin título'), [])
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
    .update({ title: title.value.trim() || t('Untitled', 'Sin título'), fields: fields.value as any, updated_by: store.teamMember?.id ?? null })
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
  if (!confirm(`${t('Delete', 'Eliminar')} "${doc.title}"?`)) return
  await supabase.from('patient_docs').delete().eq('id', doc.id)
  docs.value = docs.value.filter((d) => d.id !== doc.id)
  if (activeDoc.value?.id === doc.id) activeDoc.value = null
}

function statusFor(doc: Doc): { label: string; tone: 'success' | 'brand' } {
  return doc.completed_at ? { label: t('Complete', 'Completado'), tone: 'success' } : { label: t('Sent', 'Enviado'), tone: 'brand' }
}
function metaFor(doc: Doc) {
  if (doc.completed_at) {
    const ip = doc.completed_ip ? ` ${t('from', 'desde')} ${doc.completed_ip}` : ''
    return `${t('Signed', 'Firmado')} ${new Date(doc.completed_at).toLocaleDateString()}${ip}`
  }
  return `${t('Sent', 'Enviado')} ${new Date(doc.updated_at).toLocaleDateString()}`
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <template v-if="!activeDoc">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Docs', 'Documentos') }}</p>
        <div class="relative">
          <UiBtn variant="primary" size="sm" @click="showNewMenu = !showNewMenu">{{ t('+ New doc', '+ Nuevo documento') }}</UiBtn>
          <div v-if="showNewMenu" class="absolute right-0 z-10 mt-1 w-56 rounded-ctl border border-line bg-surface py-1 shadow-popover">
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-600 hover:bg-surface-subtle" @click="newBlankDoc">
              {{ t('Blank document', 'Documento en blanco') }}
            </button>
            <template v-if="templates.length > 0">
              <p class="mt-1 border-t border-line-divider px-3 pt-1.5 text-[11px] font-medium uppercase text-ink-faint">{{ t('From template', 'Desde plantilla') }}</p>
              <button
                v-for="t in templates"
                :key="t.id"
                type="button"
                class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-600 hover:bg-surface-subtle"
                @click="newFromTemplate(t)"
              >
                {{ t.title }}
              </button>
            </template>
          </div>
        </div>
      </div>
      <div v-if="loading" class="divide-y divide-line-row">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
          <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-ctlSm" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          </div>
        </div>
      </div>
      <div v-else-if="docs.length === 0" class="p-8 text-center text-[13px] text-ink-faint">
        {{ t('No docs yet — e.g. a data protection consent record for this patient.', 'Aún no hay documentos — p. ej. un registro de consentimiento de protección de datos para este paciente.') }}
      </div>
      <ul v-else class="divide-y divide-line-row">
        <li v-for="doc in docs" :key="doc.id" class="flex items-center gap-3 px-4 py-3">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" class="shrink-0 text-ink-faint2">
            <path d="M7 3h8l4 4v15a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" />
            <path d="M15 3v4h4" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <button type="button" class="min-w-0 flex-1 text-left" @click="openDoc(doc)">
            <p class="truncate text-[13px] font-medium text-ink-700 hover:text-brand-text">{{ doc.title }}</p>
            <p class="text-[11.5px] text-ink-faint">{{ metaFor(doc) }}</p>
          </button>
          <UiPill :tone="statusFor(doc).tone">{{ statusFor(doc).label }}</UiPill>
          <div class="flex items-center gap-2.5">
            <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" :title="t('Open patient link in a new tab', 'Abrir el enlace del paciente en una pestaña nueva')" @click="openLink(doc)">
              {{ t('Open', 'Abrir') }}
            </button>
            <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" :title="t('Copy patient link', 'Copiar el enlace del paciente')" @click="copyLink(doc)">
              {{ copiedId === doc.id ? t('Copied!', '¡Copiado!') : t('Copy link', 'Copiar enlace') }}
            </button>
            <button
              v-if="patientPhoneDigits"
              type="button"
              class="text-[11.5px] font-medium text-success-text hover:text-success-deep"
              :title="t('Send patient link via WhatsApp', 'Enviar el enlace del paciente por WhatsApp')"
              @click="sendViaWhatsApp(doc)"
            >
              WhatsApp
            </button>
            <button type="button" class="text-[11.5px] text-danger-text hover:text-danger-text/80" @click="removeDoc(doc)">{{ t('Delete', 'Eliminar') }}</button>
          </div>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <button type="button" class="text-[13px] text-ink-muted hover:text-ink-700" @click="backToList">&larr; {{ t('Docs', 'Documentos') }}</button>
        <div class="flex items-center gap-3">
          <span v-if="savedAt" class="text-[12px] text-success-text">{{ t('Saved', 'Guardado') }}</span>
          <UiBtn :variant="activeDoc?.completed_at ? 'primary' : 'secondary'" size="sm" @click="toggleComplete">
            {{ activeDoc?.completed_at ? t('✓ Completed', '✓ Completado') : t('Mark as completed', 'Marcar como completado') }}
          </UiBtn>
          <UiBtn variant="primary" size="sm" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        </div>
      </div>

      <div class="p-4">
        <input
          v-model="title"
          type="text"
          :placeholder="t('Untitled', 'Sin título')"
          class="mb-4 w-full border-none text-[20px] font-semibold text-ink-900 placeholder-ink-faint2 focus:outline-none focus:ring-0"
        />
        <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
      </div>
    </template>
  </div>
</template>
