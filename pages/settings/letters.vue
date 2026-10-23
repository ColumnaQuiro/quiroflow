<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { sanitizeLetterHtml } from '~/utils/letters'

// The templates staff start a letter from (letter_templates,
// 20261023064438_letters.sql): a name, a body with merge fields, and whether
// the clinic's logo heads the page. The rest of the letterhead -- name, NIF,
// address -- is the clinic's own, from Settings > Clinics, as on receipts.

type Template = Tables<'letter_templates'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const templates = ref<Template[]>([])
const loading = ref(true)
const active = ref<Template | null>(null)
const name = ref('')
const body = ref('')
const showLogo = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase.from('letter_templates').select('*').order('name')
  templates.value = data ?? []
  loading.value = false
}
onMounted(load)

const savedState = ref('')
function editorState() {
  return JSON.stringify({ name: name.value.trim(), body: sanitizeLetterHtml(body.value), showLogo: showLogo.value })
}
const dirty = computed(() => !!active.value && editorState() !== savedState.value)

function open(tpl: Template) {
  active.value = tpl
  name.value = tpl.name
  body.value = tpl.body
  showLogo.value = tpl.show_logo
  savedState.value = editorState()
}

async function newTemplate() {
  const { data, error } = await supabase
    .from('letter_templates')
    .insert({ account_id: store.accountId!, name: t('Untitled letter', 'Carta sin título'), body: '', created_by: store.teamMember?.id ?? null, updated_by: store.teamMember?.id ?? null })
    .select('*')
    .single()
  if (error || !data) {
    if (error) showToast(error.message, 'error')
    return
  }
  templates.value = [data, ...templates.value]
  open(data)
}

async function save() {
  if (!active.value) return
  saving.value = true
  const { data, error } = await supabase
    .from('letter_templates')
    .update({ name: name.value.trim() || t('Untitled letter', 'Carta sin título'), body: sanitizeLetterHtml(body.value), show_logo: showLogo.value, updated_by: store.teamMember?.id ?? null })
    .eq('id', active.value.id)
    .select('*')
    .single()
  saving.value = false
  if (error || !data) {
    if (error) showToast(error.message, 'error')
    return
  }
  active.value = data
  templates.value = templates.value.map((x) => (x.id === data.id ? data : x))
  savedState.value = editorState()
  showToast(t('Saved', 'Guardado'))
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
  active.value = null
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

const deleting = ref<Template | null>(null)
async function confirmDelete() {
  const tpl = deleting.value
  if (!tpl) return
  const { error } = await supabase.from('letter_templates').delete().eq('id', tpl.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  templates.value = templates.value.filter((x) => x.id !== tpl.id)
  if (active.value?.id === tpl.id) active.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Letters', 'Cartas')">
      <UiBtn v-if="!active" variant="primary" data-cy="letter-template-new" @click="newTemplate">{{ t('New template', 'Nueva plantilla') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[860px] flex-1 flex-col gap-4" data-cy="letters-settings" :data-ready="loading ? undefined : 'true'">
          <template v-if="!active">
            <p class="text-[13.5px] text-ink-muted">
              {{
                t(
                  'Letters the clinic writes about a patient: a report for their GP, a referral, a certificate of treatment. Start one from the patient’s record, under Attachments; it opens filled in with their details, ready to edit, and prints on your letterhead.',
                  'Cartas que la clínica escribe sobre un paciente: un informe para su médico, una derivación, un certificado de tratamiento. Se empiezan desde la ficha del paciente, en Adjuntos; se abren ya rellenas con sus datos, listas para editar, y se imprimen con vuestro membrete.',
                )
              }}
            </p>
            <section aria-labelledby="h-letter-templates" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
                <h2 id="h-letter-templates" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Templates · ${templates.length}`, `Plantillas · ${templates.length}`) }}</h2>
              </div>
              <template v-if="loading">
                <div v-for="i in 2" :key="i" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                  <UiSkeleton class="h-9 w-9 rounded-ctl" />
                  <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
                </div>
              </template>
              <p v-else-if="templates.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('No templates yet.', 'Todavía no hay plantillas.') }}</p>
              <div v-for="tpl in templates" :key="tpl.id" data-cy="letter-template-row" class="flex min-h-[64px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-3.5 text-left" @click="open(tpl)">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col gap-1">
                    <strong class="truncate text-[15px] text-ink-900" data-cy="letter-template-name">{{ tpl.name }}</strong>
                    <span class="text-[12.5px] text-ink-muted">{{ t('edited', 'editada el') }} {{ new Date(tpl.updated_at).toLocaleDateString('es-ES') }}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
                  :aria-label="t(`Delete ${tpl.name}`, `Eliminar ${tpl.name}`)"
                  data-cy="letter-template-delete"
                  @click="deleting = tpl"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </div>
            </section>
          </template>

          <section v-else class="overflow-hidden rounded-card border border-line bg-surface" data-cy="letter-template-editor">
            <div class="flex flex-wrap items-center gap-3 border-b border-line-row px-[18px] py-3">
              <button type="button" class="inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-ctl px-2 text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle" @click="backToList">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                {{ t('Templates', 'Plantillas') }}
              </button>
              <span class="flex-1" />
              <UiBtn variant="primary" :disabled="saving" data-cy="letter-template-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
            </div>
            <div class="flex flex-col gap-4 p-[18px]">
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input
                  v-model="name"
                  type="text"
                  maxlength="120"
                  data-cy="letter-template-name-input"
                  :placeholder="t('Untitled letter', 'Carta sin título')"
                  class="h-10 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[16px] font-semibold text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </label>
              <div class="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Letterhead', 'Membrete') }}</span>
                <label class="flex items-center gap-2 text-[13.5px] text-ink-700">
                  <input v-model="showLogo" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" data-cy="letter-template-logo" />
                  {{ t('Print the clinic’s logo', 'Imprimir el logotipo de la clínica') }}
                </label>
                <span class="text-[12.5px] leading-snug text-ink-muted">
                  {{ t('The clinic’s name, NIF and address head every letter, from Settings › Clinics, as on receipts.', 'El nombre, el NIF y la dirección de la clínica encabezan cada carta, desde Ajustes › Clínicas, como en los recibos.') }}
                </span>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Letter', 'Carta') }}</span>
                <LettersEditor v-model="body" fields :label="t('Template text', 'Texto de la plantilla')" />
                <span class="text-[12.5px] leading-snug text-ink-muted">
                  {{
                    t(
                      'Fields are filled in with the patient’s and the clinic’s details when a letter is started from this template. Chief complaint and diagnosis are filled in only for someone allowed to see clinical notes.',
                      'Los campos se rellenan con los datos del paciente y de la clínica al empezar una carta con esta plantilla. Motivo de consulta y diagnóstico solo se rellenan para quien puede ver las notas clínicas.',
                    )
                  }}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.name}”?`, `¿Eliminar «${deleting.name}»?`)"
      :confirm-label="t('Delete template', 'Eliminar plantilla')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Letters already written with it stay on each patient’s record.', 'Las cartas ya escritas con ella se quedan en la ficha de cada paciente.') }}</p>
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
