<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import type { DocField } from '~/utils/docFields'

type Template = Omit<Tables<'doc_templates'>, 'fields'> & { fields: DocField[] }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const templates = ref<Template[]>([])
const loading = ref(true)
const activeTemplate = ref<Template | null>(null)
const title = ref('')
const fields = ref<DocField[]>([])
const saving = ref(false)
const savedAt = ref<Date | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase.from('doc_templates').select('*').order('updated_at', { ascending: false })
  templates.value = (data as unknown as Template[]) ?? []
  loading.value = false
}
onMounted(load)

const category = ref<string>('')

function openTemplate(t: Template) {
  activeTemplate.value = t
  title.value = t.title
  fields.value = Array.isArray(t.fields) ? [...t.fields] : []
  category.value = t.category ?? ''
  savedAt.value = null
}

function categoryLabel(c: string | null) {
  if (c === 'data_protection') return t('Data protection', 'Protección de datos')
  if (c === 'consent') return t('Consent', 'Consentimiento')
  return null
}

async function newTemplate() {
  const { data, error } = await supabase
    .from('doc_templates')
    .insert({
      account_id: store.accountId!,
      title: t('Untitled template', 'Plantilla sin título'),
      fields: [],
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
  if (!activeTemplate.value) return
  saving.value = true
  const { error } = await supabase
    .from('doc_templates')
    .update({
      title: title.value.trim() || t('Untitled template', 'Plantilla sin título'),
      fields: fields.value as any,
      category: category.value || null,
      updated_by: store.teamMember?.id ?? null,
    })
    .eq('id', activeTemplate.value.id)
  saving.value = false
  if (!error) savedAt.value = new Date()
}

async function removeTemplate(tmpl: Template) {
  if (!confirm(t(`Delete "${tmpl.title}"?`, `¿Eliminar "${tmpl.title}"?`))) return
  await supabase.from('doc_templates').delete().eq('id', tmpl.id)
  templates.value = templates.value.filter((x) => x.id !== tmpl.id)
  if (activeTemplate.value?.id === tmpl.id) activeTemplate.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Docs', 'Documentos')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('Reusable document templates — build one once (e.g. a data protection consent form) with headings, questions, and patient-field placeholders, then generate a filled-in copy for each patient from their Docs tab.', 'Plantillas de documentos reutilizables — crea una vez (p. ej. un formulario de consentimiento de protección de datos) con títulos, preguntas y marcadores de campos del paciente, y luego genera una copia rellenada para cada paciente desde su pestaña Documentos.') }}
          </p>

          <div class="mt-6 rounded-card border border-line bg-surface shadow-card">
            <template v-if="!activeTemplate">
              <div class="flex items-center justify-between border-b border-line-divider p-4">
                <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Templates', 'Plantillas') }}</h3>
                <UiBtn variant="primary" size="sm" @click="newTemplate">+ {{ t('New Template', 'Nueva plantilla') }}</UiBtn>
              </div>
              <div v-if="loading" class="divide-y divide-line-row">
                <div v-for="i in 3" :key="i" class="px-4 py-3">
                  <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
                </div>
              </div>
              <div v-else-if="templates.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No templates yet.', 'Todavía no hay plantillas.') }}</div>
              <ul v-else class="divide-y divide-line-row">
                <li v-for="tpl in templates" :key="tpl.id" class="flex items-center justify-between px-4 py-3">
                  <button type="button" class="text-left text-[13.5px] font-[560] text-ink-700 hover:text-brand-text" @click="openTemplate(tpl)">
                    {{ tpl.title }}
                    <UiPill v-if="categoryLabel(tpl.category)" tone="brand" class="ml-1.5">{{ categoryLabel(tpl.category) }}</UiPill>
                  </button>
                  <div class="flex items-center gap-3">
                    <span class="text-[12px] text-ink-faint">{{ new Date(tpl.updated_at).toLocaleString() }}</span>
                    <button type="button" class="text-[12.5px] text-danger-text hover:text-danger-text/80" @click="removeTemplate(tpl)">{{ t('Delete', 'Eliminar') }}</button>
                  </div>
                </li>
              </ul>
            </template>

            <template v-else>
              <div class="flex items-center justify-between border-b border-line-divider p-4">
                <button type="button" class="text-[13px] text-ink-muted2 hover:text-ink-600" @click="backToList">&larr; {{ t('Templates', 'Plantillas') }}</button>
                <div class="flex items-center gap-3">
                  <span v-if="savedAt" class="text-[12.5px] text-success-text">{{ t('Saved', 'Guardado') }}</span>
                  <UiBtn variant="primary" size="sm" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
                </div>
              </div>

              <div class="p-4">
                <input
                  v-model="title"
                  type="text"
                  :placeholder="t('Untitled template', 'Plantilla sin título')"
                  class="mb-2 w-full border-none text-[18px] font-semibold text-ink-900 placeholder-ink-faint3 focus:outline-none focus:ring-0"
                />
                <label class="mb-4 flex items-center gap-2 text-[13px] text-ink-600">
                  {{ t('Category', 'Categoría') }}
                  <select v-model="category" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                    <option value="">{{ t('None', 'Ninguna') }}</option>
                    <option value="data_protection">{{ t('Data protection', 'Protección de datos') }}</option>
                    <option value="consent">{{ t('Consent', 'Consentimiento') }}</option>
                  </select>
                  <span class="text-[12px] text-ink-faint">{{ t("Lets Reports track who's missing this form", 'Permite que Informes registre a quién le falta este formulario') }}</span>
                </label>
                <DocBlocks :fields="fields" mode="build" @update:fields="fields = $event" />
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
