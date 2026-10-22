<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'
import { letterFileName, sanitizeLetterHtml } from '~/utils/letters'

// Letters written about this patient (patient_letters,
// 20261022185121_letters.sql). "New letter" fills a template from Settings ›
// Letters with their details (/api/patients/[id]/letters/draft), the writer
// edits it, and it is kept here as written: download, print, and -- with
// the permission for it -- edit and delete. The PDF is the clinic's
// letterhead around the body (/api/patient-letters/[id]/pdf), and each one
// is logged in the patient's access log as an export.

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const { can } = usePermission()
const logAccess = useAccessLog()

interface Letter {
  id: string
  title: string
  body: string
  show_logo: boolean
  clinic_id: string | null
  template_id: string | null
  created_at: string
  updated_at: string
  author: { full_name: string } | null
}

const letters = ref<Letter[]>([])
const templates = ref<{ id: string; name: string }[]>([])
const loading = ref(true)
const showNewMenu = ref(false)

async function load() {
  loading.value = true
  const [{ data: letterData }, { data: templateData }] = await Promise.all([
    supabase
      .from('patient_letters')
      .select('id, title, body, show_logo, clinic_id, template_id, created_at, updated_at, author:team_members!patient_letters_created_by_fkey(full_name)')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false }),
    supabase.from('letter_templates').select('id, name').order('name'),
  ])
  letters.value = (letterData as unknown as Letter[]) ?? []
  templates.value = templateData ?? []
  loading.value = false
}
onMounted(load)

// ---- the editor: a new draft, or a saved letter opened again
const editing = ref<{ id: string | null; templateId: string | null; clinicId: string | null } | null>(null)
const title = ref('')
const body = ref('')
const showLogo = ref(true)
const clinicalOmitted = ref(false)
const drafting = ref(false)
const saving = ref(false)
const readOnly = computed(() => !can('patients_edit'))

async function newLetter(templateId: string | null) {
  showNewMenu.value = false
  drafting.value = true
  try {
    const draft = await useStaffFetch<{ title: string; body: string; showLogo: boolean; clinicId: string | null; clinicalOmitted: boolean }>(`/api/patients/${props.patientId}/letters/draft`, {
      method: 'POST',
      body: { templateId, clinicId: store.currentClinicId },
    })
    editing.value = { id: null, templateId, clinicId: draft.clinicId }
    title.value = draft.title || t('Letter', 'Carta')
    body.value = draft.body
    showLogo.value = draft.showLogo
    clinicalOmitted.value = draft.clinicalOmitted
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not start the letter.', 'No se pudo empezar la carta.'), 'error')
  } finally {
    drafting.value = false
  }
}

function openLetter(letter: Letter) {
  editing.value = { id: letter.id, templateId: letter.template_id, clinicId: letter.clinic_id }
  title.value = letter.title
  body.value = letter.body
  showLogo.value = letter.show_logo
  clinicalOmitted.value = false
  logAccess('file_viewed', props.patientId, { letter: letter.title })
}

function closeEditor() {
  editing.value = null
}

async function save() {
  const current = editing.value
  if (!current) return
  saving.value = true
  const values = {
    title: title.value.trim() || t('Letter', 'Carta'),
    body: sanitizeLetterHtml(body.value),
    show_logo: showLogo.value,
    updated_by: store.teamMember?.id ?? null,
  }
  const { error } = current.id
    ? await supabase.from('patient_letters').update(values).eq('id', current.id)
    : await supabase.from('patient_letters').insert({
        ...values,
        account_id: store.accountId!,
        patient_id: props.patientId,
        template_id: current.templateId,
        clinic_id: current.clinicId,
        created_by: store.teamMember?.id ?? null,
      })
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Letter saved', 'Carta guardada'))
  editing.value = null
  load()
}

// ---- the PDF
const busyId = ref<string | null>(null)
async function fetchPdf(letter: Letter, inline: boolean) {
  busyId.value = letter.id
  try {
    const blob = await useStaffFetch<Blob>(`/api/patient-letters/${letter.id}/pdf${inline ? '?inline=1' : ''}`, { responseType: 'blob' })
    return URL.createObjectURL(blob)
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not prepare the PDF.', 'No se pudo preparar el PDF.'), 'error')
    return null
  } finally {
    busyId.value = null
  }
}
async function download(letter: Letter) {
  const url = await fetchPdf(letter, false)
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = letterFileName(letter.title, letter.created_at)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
// Printed from a hidden frame, so the print dialog opens over the record; a
// browser that will not print a PDF from a frame gets it in a new tab.
async function print(letter: Letter) {
  const url = await fetchPdf(letter, true)
  if (!url) return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      window.open(url, '_blank')
    }
  }
  frame.src = url
  document.body.appendChild(frame)
  setTimeout(() => {
    frame.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}

// ---- delete
const deleting = ref<Letter | null>(null)
async function confirmDelete() {
  const letter = deleting.value
  if (!letter) return
  const { error } = await supabase.from('patient_letters').delete().eq('id', letter.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  letters.value = letters.value.filter((x) => x.id !== letter.id)
}

function metaFor(letter: Letter) {
  const written = formatLongDate(letter.created_at)
  return letter.author ? `${written} · ${letter.author.full_name}` : written
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card" data-cy="patient-letters" :data-ready="loading ? undefined : 'true'">
    <template v-if="!editing">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <p class="text-[13.5px] font-semibold text-ink-700">
          {{ t('Letters', 'Cartas') }}
          <span v-if="!loading" class="ml-1 font-normal text-ink-faint" data-cy="letters-count">{{ letters.length }}</span>
        </p>
        <div v-if="can('patients_edit')" class="relative">
          <UiBtn variant="primary" size="sm" :disabled="drafting" data-cy="letter-new" @click="showNewMenu = !showNewMenu">{{ drafting ? t('Preparing…', 'Preparando…') : t('New letter', 'Nueva carta') }}</UiBtn>
          <div v-if="showNewMenu" class="absolute right-0 z-10 mt-1 w-64 rounded-ctl border border-line bg-surface py-1 shadow-popover" data-cy="letter-new-menu">
            <template v-if="templates.length > 0">
              <p class="px-3 pt-1 text-[11px] font-medium uppercase text-ink-faint">{{ t('From template', 'Desde plantilla') }}</p>
              <button v-for="tpl in templates" :key="tpl.id" type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-600 hover:bg-surface-subtle" @click="newLetter(tpl.id)">
                {{ tpl.name }}
              </button>
            </template>
            <button type="button" class="mt-1 block w-full border-t border-line-divider px-3 py-1.5 text-left text-[13px] text-ink-600 hover:bg-surface-subtle" @click="newLetter(null)">
              {{ t('Blank letter', 'Carta en blanco') }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="loading" class="divide-y divide-line-row">
        <div v-for="i in 2" :key="i" class="flex items-center gap-3 px-4 py-3">
          <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-ctlSm" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          </div>
        </div>
      </div>
      <div v-else-if="letters.length === 0" class="p-8 text-center text-[13px] text-ink-faint">
        {{ t('No letters yet — e.g. a report for their GP or a certificate of treatment.', 'Aún no hay cartas — p. ej. un informe para su médico o un certificado de tratamiento.') }}
      </div>
      <ul v-else class="divide-y divide-line-row">
        <li v-for="letter in letters" :key="letter.id" data-cy="letter-row" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" class="shrink-0 text-ink-faint2" aria-hidden="true">
            <path d="M4 7h18v13H4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
            <path d="M4 8l9 6.5L22 8" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
          </svg>
          <button type="button" class="min-w-0 flex-1 basis-[calc(100%-38px)] text-left outline-none focus-visible:shadow-focus sm:basis-0" data-cy="letter-open" @click="openLetter(letter)">
            <p class="truncate text-[13px] font-medium text-ink-700 hover:text-brand-text" data-cy="letter-title">{{ letter.title }}</p>
            <p class="text-[11.5px] text-ink-faint">{{ metaFor(letter) }}</p>
          </button>
          <div class="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 pl-[38px] sm:w-auto sm:flex-nowrap sm:pl-0">
            <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-60 touch:min-h-11" :disabled="busyId === letter.id" data-cy="letter-download" @click="download(letter)">
              {{ t('Download', 'Descargar') }}
            </button>
            <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-60 touch:min-h-11" :disabled="busyId === letter.id" data-cy="letter-print" @click="print(letter)">
              {{ t('Print', 'Imprimir') }}
            </button>
            <UiIconBtn v-if="can('patient_docs_delete')" icon="trash" tone="danger" data-cy="letter-delete" :label="t('Delete', 'Eliminar')" @click="deleting = letter" />
          </div>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider px-4 py-3">
        <button type="button" class="text-[13px] text-ink-muted hover:text-ink-700" @click="closeEditor">&larr; {{ t('Letters', 'Cartas') }}</button>
        <UiBtn v-if="!readOnly" variant="primary" size="sm" :disabled="saving" data-cy="letter-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save letter', 'Guardar carta') }}</UiBtn>
      </div>
      <div class="flex flex-col gap-3 p-4" data-cy="letter-editor">
        <p v-if="clinicalOmitted" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] leading-snug text-warning-text" data-cy="letter-clinical-omitted">
          {{ t('This template asks for the chief complaint and diagnosis, which only someone allowed to see clinical notes can fill in. They have been left blank.', 'Esta plantilla pide el motivo de consulta y el diagnóstico, que solo puede rellenar quien ve las notas clínicas. Se han dejado en blanco.') }}
        </p>
        <input
          v-model="title"
          type="text"
          maxlength="200"
          :readonly="readOnly"
          data-cy="letter-title-input"
          :aria-label="t('Title', 'Título')"
          :placeholder="t('Letter', 'Carta')"
          class="w-full border-none bg-transparent text-[20px] font-semibold text-ink-900 placeholder-ink-faint2 focus:outline-none focus:ring-0"
        />
        <LettersEditor v-model="body" :readonly="readOnly" />
        <label v-if="!readOnly" class="flex items-center gap-2 text-[13px] text-ink-700">
          <input v-model="showLogo" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" data-cy="letter-logo" />
          {{ t('Print the clinic’s logo', 'Imprimir el logotipo de la clínica') }}
        </label>
      </div>
    </template>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.title}”?`, `¿Eliminar «${deleting.title}»?`)"
      :confirm-label="t('Delete letter', 'Eliminar carta')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('It is removed from the record. Copies already printed or sent are not affected.', 'Se quita de la ficha. Las copias ya impresas o enviadas no cambian.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
