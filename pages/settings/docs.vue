<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import type { DocField } from '~/utils/docFields'

type Template = Omit<Tables<'doc_templates'>, 'fields'> & { fields: DocField[] }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const templates = ref<Template[]>([])
const loading = ref(true)
const activeTemplate = ref<Template | null>(null)
const title = ref('')
const fields = ref<DocField[]>([])
const saving = ref(false)

// How many patients each template was sent to, and how many filled it in:
// patient_docs keeps the template it came from. Head counts, since a clinic's
// forms run to the thousands and a select of them would hit the row cap.
const counts = ref<Record<string, { sent: number; done: number }>>({})

async function load() {
  loading.value = true
  const { data } = await supabase.from('doc_templates').select('*').order('updated_at', { ascending: false })
  templates.value = (data as unknown as Template[]) ?? []
  loading.value = false
  const results = await Promise.all(
    templates.value.map((tpl) =>
      Promise.all([
        supabase.from('patient_docs').select('id', { count: 'exact', head: true }).eq('template_id', tpl.id),
        supabase.from('patient_docs').select('id', { count: 'exact', head: true }).eq('template_id', tpl.id).not('completed_at', 'is', null),
      ]),
    ),
  )
  counts.value = Object.fromEntries(templates.value.map((tpl, i) => [tpl.id, { sent: results[i][0].count ?? 0, done: results[i][1].count ?? 0 }]))
}

function countsLabel(id: string) {
  const c = counts.value[id]
  if (!c) return ''
  if (c.sent === 0) return t('Not sent yet', 'Aún sin enviar')
  return t(`${c.sent} sent · ${c.done} completed`, `${c.sent} enviados · ${c.done} completados`)
}
function donePercent(id: string) {
  const c = counts.value[id]
  return c && c.sent ? Math.round((c.done / c.sent) * 100) : 0
}
function questionCount(tpl: Template) {
  const n = Array.isArray(tpl.fields) ? tpl.fields.length : 0
  return n === 1 ? t('1 block', '1 bloque') : t(`${n} blocks`, `${n} bloques`)
}
onMounted(load)

const category = ref<string>('')

function openTemplate(t: Template) {
  activeTemplate.value = t
  title.value = t.title
  fields.value = Array.isArray(t.fields) ? [...t.fields] : []
  category.value = t.category ?? ''
  savedState.value = editorState()
}

// What the editor held when it was opened or last saved. The back button
// used to drop unsaved edits without a word.
const savedState = ref('')
function editorState() {
  return JSON.stringify({ title: title.value.trim(), fields: fields.value, category: category.value })
}
const dirty = computed(() => !!activeTemplate.value && editorState() !== savedState.value)

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
  if (dirty.value) {
    leaveOpen.value = true
    return
  }
  closeEditor()
}
function closeEditor() {
  leaveOpen.value = false
  activeTemplate.value = null
  load()
}

// Leaving the page, not only the editor.
const leaveOpen = ref(false)
const pendingLeave = ref<string | null>(null)
const router = useRouter()
onBeforeRouteLeave((to) => {
  if (!dirty.value || pendingLeave.value === to.fullPath) return true
  pendingLeave.value = to.fullPath
  leaveOpen.value = true
  return false
})
function leaveAnyway() {
  const to = pendingLeave.value
  if (to) {
    leaveOpen.value = false
    router.push(to)
  } else {
    closeEditor()
  }
}
function stayHere() {
  leaveOpen.value = false
  pendingLeave.value = null
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

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
  if (error) {
    showToast(error.message, 'error')
    return
  }
  savedState.value = editorState()
  showToast(t('Saved', 'Guardado'))
}

// Asked in an in-app dialog rather than confirm(), and saying what happens
// to the forms already sent (patient_docs keeps its own copy of the fields).
const deleting = ref<Template | null>(null)
async function confirmDelete() {
  const tmpl = deleting.value
  if (!tmpl) return
  const { error } = await supabase.from('doc_templates').delete().eq('id', tmpl.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  templates.value = templates.value.filter((x) => x.id !== tmpl.id)
  if (activeTemplate.value?.id === tmpl.id) activeTemplate.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Docs', 'Documentos')">
      <UiBtn v-if="!activeTemplate" variant="primary" data-cy="doc-new" @click="newTemplate">{{ t('New Template', 'Nueva plantilla') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[860px] flex-1 flex-col gap-4" data-cy="docs-settings" :data-ready="loading ? undefined : 'true'">
          <!-- The list -->
          <template v-if="!activeTemplate">
            <p class="text-[13.5px] text-ink-muted">
              {{ t('Forms you build once (consent, data protection, intake) and send to each patient to fill in and sign.', 'Formularios que creas una vez (consentimiento, protección de datos, anamnesis) y envías a cada paciente para rellenar y firmar.') }}
            </p>
            <section aria-labelledby="h-templates" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
                <h2 id="h-templates" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Templates · ${templates.length}`, `Plantillas · ${templates.length}`) }}</h2>
                <span v-if="templates.length" class="text-[13px] text-ink-muted max-sm:hidden">{{ t('Sent · completed', 'Enviados · completados') }}</span>
              </div>
              <template v-if="loading">
                <div v-for="i in 3" :key="i" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                  <UiSkeleton class="h-9 w-9 rounded-ctl" />
                  <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
                </div>
              </template>
              <p v-else-if="templates.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('No templates yet.', 'Todavía no hay plantillas.') }}</p>
              <div v-for="tpl in templates" :key="tpl.id" data-cy="doc-row" class="flex min-h-[72px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-3.5 text-left" @click="openTemplate(tpl)">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" /></svg>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="flex flex-wrap items-center gap-2">
                      <strong class="truncate text-[15px] text-ink-900" data-cy="doc-title">{{ tpl.title }}</strong>
                      <UiPill v-if="categoryLabel(tpl.category)" tone="brand">{{ categoryLabel(tpl.category) }}</UiPill>
                    </span>
                    <span class="text-[12.5px] text-ink-muted">{{ questionCount(tpl) }} · {{ t('edited', 'editada el') }} {{ new Date(tpl.updated_at).toLocaleDateString('es-ES') }}</span>
                  </span>
                  <span class="flex w-[170px] shrink-0 flex-col items-end gap-1.5 max-sm:hidden">
                    <span class="text-[13px] text-ink-500" data-cy="doc-counts">{{ countsLabel(tpl.id) }}</span>
                    <span class="h-1.5 w-[120px] overflow-hidden rounded-pill bg-chip-bg" aria-hidden="true"><span class="block h-full rounded-pill bg-success-accent" :style="{ width: `${donePercent(tpl.id)}%` }" /></span>
                  </span>
                </button>
                <button
                  type="button"
                  class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
                  :aria-label="t(`Delete ${tpl.title}`, `Eliminar ${tpl.title}`)"
                  data-cy="doc-delete"
                  @click="deleting = tpl"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </div>
            </section>
            <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
              {{ t('A category lets Reports list the patients still missing that form. Editing a template changes what is sent from now on; forms already sent keep their questions.', 'Una categoría permite que Informes liste a los pacientes a los que les falta ese formulario. Editar una plantilla cambia lo que se envía a partir de ahora; los formularios ya enviados conservan sus preguntas.') }}
            </p>
          </template>

          <!-- The builder -->
          <section v-else class="overflow-hidden rounded-card border border-line bg-surface" data-cy="doc-editor">
            <div class="flex flex-wrap items-center gap-3 border-b border-line-row px-[18px] py-3">
              <button type="button" class="inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-ctl px-2 text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle" @click="backToList">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                {{ t('Templates', 'Plantillas') }}
              </button>
              <span class="flex-1" />
              <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
            </div>
            <div class="flex flex-col gap-4 p-[18px]">
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input v-model="title" type="text" :placeholder="t('Untitled template', 'Plantilla sin título')" class="h-10 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[16px] font-semibold text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
              </label>
              <div class="flex flex-wrap items-center gap-3">
                <label for="doc-category" class="text-[13px] font-semibold text-ink-700">{{ t('Category', 'Categoría') }}</label>
                <select id="doc-category" v-model="category" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                  <option value="">{{ t('None', 'Ninguna') }}</option>
                  <option value="data_protection">{{ t('Data protection', 'Protección de datos') }}</option>
                  <option value="consent">{{ t('Consent', 'Consentimiento') }}</option>
                </select>
                <span class="text-[12.5px] text-ink-muted">{{ t("Lets Reports track who's missing this form.", 'Permite que Informes registre a quién le falta este formulario.') }}</span>
              </div>
              <DocBlocks :fields="fields" mode="build" @update:fields="fields = $event" />
            </div>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.title}”?`, `¿Eliminar «${deleting.title}»?`)"
      :confirm-label="t('Delete template', 'Eliminar plantilla')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('It can no longer be sent. Forms already sent with it stay on each patient’s record.', 'Ya no se podrá enviar. Los formularios ya enviados con ella se quedan en la ficha de cada paciente.') }}</p>
      <p v-if="deleting.category" class="text-[14px] leading-snug text-warning-text">{{ t('Reports stops counting them as this category, though: every patient shows as missing it until another template in the category is sent.', 'Pero Informes deja de contarlos en esta categoría: todos los pacientes aparecerán sin ella hasta que se envíe otra plantilla de la categoría.') }}</p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="leaveOpen"
      :title="t('Leave without saving?', '¿Salir sin guardar?')"
      :confirm-label="t('Leave without saving', 'Salir sin guardar')"
      :cancel-label="t('Keep editing', 'Seguir editando')"
      @confirm="leaveAnyway"
      @cancel="stayHere"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('The changes to this template have not been saved.', 'Los cambios de esta plantilla no se han guardado.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
