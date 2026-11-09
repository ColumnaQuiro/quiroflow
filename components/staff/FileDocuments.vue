<script setup lang="ts">
import { openWhenReady } from '../../utils/openWhenReady'
import { STAFF_DOCUMENTS_BUCKET, STAFF_DOCUMENT_CATEGORIES, staffDocumentCategoryLabel, staffDocumentName, visibleToPerson, type StaffDocument } from '../../utils/staffDocuments'

// A person's file › Documentos (owners): their nóminas, contracts,
// certificates and partes de baja. Each shows whether the person has opened
// it ("Visto", a read receipt rather than a signature); a parte de baja is
// health data and stays with owners. Leaving deletes nothing: the file of
// someone who has left keeps their papers.
const props = defineProps<{ accountId: string; memberId: string; name: string; gone: boolean }>()
const t = useT()
const { preference: lang } = useLang()
const locale = computed(() => uiLocaleTag(lang.value))
const supabase = useSupabaseClient()
const logAccess = useAccessLog()
const { upload, announce, problemWith } = useStaffDocumentUpload()

const docs = ref<StaffDocument[]>([])
const loaded = ref(false)
const error = ref('')
async function load() {
  const { data, error: e } = await supabase
    .from('staff_documents')
    .select('id, team_member_id, category, period, title, storage_path, file_name, size_bytes, uploaded_at, first_viewed_at')
    .eq('account_id', props.accountId)
    .eq('team_member_id', props.memberId)
    .order('uploaded_at', { ascending: false })
  error.value = e ? t("Couldn't load the documents.", 'No se han podido cargar los documentos.') : ''
  docs.value = (data as StaffDocument[] | null) ?? []
  loaded.value = true
}
onMounted(load)

const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
function seenText(d: StaffDocument) {
  if (!visibleToPerson(d)) return t('Owners only', 'Solo propietarios')
  return d.first_viewed_at ? t(`Seen ${fmt(d.first_viewed_at)}`, `Visto el ${fmt(d.first_viewed_at)}`) : t('Not opened yet', 'Sin abrir')
}

function open(d: StaffDocument) {
  // An owner opening someone's papers is on the activity log, as opening a
  // patient's file is: a trigger cannot see a read.
  logAccess('file_viewed', null, { staff_document: d.id, of: props.name, category: d.category })
  openWhenReady(async () => {
    const { data } = await supabase.storage.from(STAFF_DOCUMENTS_BUCKET).createSignedUrl(d.storage_path, 60 * 5)
    return data?.signedUrl
  })
}

// ---- uploading
const adding = ref(false)
const form = reactive({ category: 'payslip', month: '', title: '' })
const files = ref<File[]>([])
const saving = ref(false)
const formError = ref('')
function lastMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function openAdd() {
  Object.assign(form, { category: 'payslip', month: lastMonth(), title: '' })
  files.value = []
  formError.value = ''
  adding.value = true
}
function picked(e: Event) {
  files.value = [...((e.target as HTMLInputElement).files ?? [])]
}
const problem = computed(() => {
  if (!files.value.length) return t('Choose a file.', 'Elige un archivo.')
  if (form.category === 'payslip' && !form.month) return t('Choose the month the payslip is for.', 'Elige el mes de la nómina.')
  return files.value.map(problemWith).find(Boolean) ?? ''
})
async function save() {
  if (problem.value) return
  saving.value = true
  formError.value = ''
  const ids: string[] = []
  try {
    for (const file of files.value) {
      ids.push(await upload({ accountId: props.accountId, teamMemberId: props.memberId, file, category: form.category, month: form.category === 'payslip' ? form.month : null, title: files.value.length === 1 ? form.title : null }))
    }
    adding.value = false
  } catch (e: any) {
    formError.value = e?.message ?? t("Couldn't upload it.", 'No se ha podido subir.')
  } finally {
    saving.value = false
    if (ids.length) {
      announce(ids)
      await load()
    }
  }
}

const removing = ref<StaffDocument | null>(null)
const removeBusy = ref(false)
async function remove() {
  const d = removing.value
  if (!d) return
  removeBusy.value = true
  const { error: e } = await supabase.from('staff_documents').delete().eq('id', d.id)
  if (!e) await supabase.storage.from(STAFF_DOCUMENTS_BUCKET).remove([d.storage_path])
  removeBusy.value = false
  if (e) {
    error.value = e.message
    return
  }
  removing.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-ink-700'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="file-documents" :data-ready="loaded ? 'true' : undefined">
    <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
    <div class="flex flex-wrap items-center gap-3">
      <p class="flex-1 text-[13px] text-ink-muted">{{ gone ? t('Kept after they left: contracts and payslips have to be held for years.', 'Se conservan aunque ya no esté: contratos y nóminas hay que guardarlos años.') : t(`${name} sees their own in Working time › Mine, on the web and in the app, and gets a notification when one arrives.`, `${name} ve los suyos en Registro de jornada › Mi jornada, en la web y en la app, y recibe un aviso cuando llega uno.`) }}</p>
      <UiBtn v-if="!adding" variant="primary" size="sm" data-cy="documents-add" @click="openAdd">{{ t('Upload', 'Subir') }}</UiBtn>
    </div>

    <form v-if="adding" class="flex flex-col gap-4 rounded-card border border-line bg-surface px-4 py-4" data-cy="documents-form" @submit.prevent="save">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Upload documents', 'Subir documentos') }}</h2>
      <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Kind', 'Tipo')">
        <button
          v-for="c in STAFF_DOCUMENT_CATEGORIES"
          :key="c"
          type="button"
          class="h-8 touch:h-11 rounded-full border px-3 text-[13px] font-semibold"
          :class="form.category === c ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
          :aria-pressed="form.category === c"
          :data-cy="`documents-category-${c}`"
          @click="form.category = c"
        >
          {{ staffDocumentCategoryLabel(c, t) }}
        </button>
      </div>
      <p v-if="form.category === 'sick_note'" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text" data-cy="documents-sick-note-hint">
        {{ t('Only owners see a sick note, not even the person. Upload the official parte, never a diagnosis or a medical report.', 'Un parte de baja solo lo ven los propietarios, ni siquiera la persona. Sube el parte oficial, nunca un diagnóstico ni un informe médico.') }}
      </p>
      <div class="flex flex-wrap gap-3">
        <label v-if="form.category === 'payslip'" :class="label">
          {{ t('Month', 'Mes') }}
          <input v-model="form.month" type="month" :class="inputClass" data-cy="documents-month" />
        </label>
        <label v-if="files.length <= 1" :class="label" class="min-w-[14rem] flex-1">
          {{ t('Name (optional)', 'Nombre (opcional)') }}
          <input v-model="form.title" type="text" maxlength="200" :class="inputClass" data-cy="documents-title" />
        </label>
      </div>
      <label :class="label">
        {{ t('Files (PDF, JPG or PNG)', 'Archivos (PDF, JPG o PNG)') }}
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" class="text-[13px] font-normal" data-cy="documents-file" @change="picked" />
      </label>
      <p v-if="formError || (problem && files.length)" role="alert" class="text-[13px] text-danger-text">{{ formError || problem }}</p>
      <div class="flex gap-2">
        <UiBtn variant="primary" type="submit" :disabled="saving || !!problem" data-cy="documents-save">{{ saving ? t('Uploading…', 'Subiendo…') : t('Upload', 'Subir') }}</UiBtn>
        <UiBtn variant="ghost" @click="adding = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <div v-if="!loaded" aria-busy="true"><UiSkeleton class="h-24 w-full rounded-card" /></div>
    <UiEmptyState v-else-if="!docs.length && !adding" :title="t('No documents yet.', 'Todavía no hay documentos.')" :description="t('Payslips from the gestoría, the signed contract, certificates. One PDF per person, or several at once with the month picked for all of them.', 'Nóminas de la gestoría, el contrato firmado, certificados. Un PDF por persona, o varios a la vez con el mes elegido para todos.')" data-cy="documents-empty" />
    <ul v-else-if="docs.length" class="divide-y divide-line-row overflow-hidden rounded-card border border-line bg-surface">
      <li v-for="d in docs" :key="d.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" data-cy="documents-row" :data-category="d.category">
        <span class="min-w-0 flex-1">
          <button type="button" class="block max-w-full truncate text-left text-[14px] font-semibold text-ink-900 hover:underline" data-cy="documents-open" @click="open(d)">{{ staffDocumentName(d, t, locale) }}</button>
          <span class="block text-[12px] text-ink-muted">{{ staffDocumentCategoryLabel(d.category, t) }} · {{ t(`uploaded ${fmt(d.uploaded_at)}`, `subido el ${fmt(d.uploaded_at)}`) }}</span>
        </span>
        <UiPill :tone="!visibleToPerson(d) ? 'neutral' : d.first_viewed_at ? 'success' : 'warning'" data-cy="documents-seen">{{ seenText(d) }}</UiPill>
        <UiBtn size="sm" variant="ghost" data-cy="documents-delete" @click="removing = d">{{ t('Delete', 'Borrar') }}</UiBtn>
      </li>
    </ul>

    <UiConfirmDialog
      v-if="removing"
      tone="danger"
      :title="t('Delete this document?', '¿Borrar este documento?')"
      :confirm-label="t('Delete', 'Borrar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="removeBusy"
      @confirm="remove"
      @cancel="removing = null"
    >
      <p class="text-[14px] text-ink-500">{{ t('For one uploaded by mistake. Payslips and contracts have to be kept for years, including after someone leaves.', 'Para uno subido por error. Nóminas y contratos hay que guardarlos años, también cuando alguien se va.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
