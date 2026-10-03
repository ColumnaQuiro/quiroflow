<script setup lang="ts">
import { formatShortDate } from '~/utils/billing'
import type { Tables } from '~/types/database.types'
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { MIN_DOCUMENT_PASSWORD_LENGTH, captionRevealsPassword, defaultProtectedCaption, documentPassword, isSpanishId } from '~/utils/protectedDocument'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()

// `visibility` isn't in the generated Supabase types yet -- merge it in
// locally rather than editing the generated file by hand.
type PatientFile = Tables<'patient_files'> & { visibility: 'generic' | 'custom' }

const files = ref<PatientFile[]>([])
const thumbUrls = ref<Record<string, string>>({})
const loading = ref(true)
const uploading = ref(false)
// uploaded_by was written on every upload and read by nothing, so a file
// nobody recognised had no one to ask about it.
const uploaders = ref<Record<string, string>>({})
async function loadUploaders() {
  const { data } = await supabase.from('team_members').select('id, full_name')
  const map: Record<string, string> = {}
  for (const m of data ?? []) map[m.id] = m.full_name
  uploaders.value = map
}
onMounted(loadUploaders)

/** "469 KB · 22 sept · Dr Ruiz · PDF", minus whatever is unknown. */
function fileMeta(file: PatientFile) {
  return [
    formatSize(file.size_bytes),
    formatShortDate(file.created_at),
    file.uploaded_by ? uploaders.value[file.uploaded_by] : null,
    kindLabel(file),
  ]
    .filter(Boolean)
    .join(' · ')
}

// Dropping onto the card is how people file things; the button stays for
// everyone else.
const dragging = ref(false)
function onDrop(event: DragEvent) {
  dragging.value = false
  const dropped = event.dataTransfer?.files
  if (dropped?.length) uploadFiles(dropped)
}
const error = ref('')
const fileInput = ref<HTMLInputElement>()

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patient_files')
    .select('*')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  files.value = (data as unknown as PatientFile[]) ?? []
  loading.value = false

  // PDFs get a signed URL too, not just images. A scanned report or an MRI
  // write-up is the common case here and a diagonal-stripe placeholder with
  // "PDF" on it tells the practitioner nothing -- they end up opening every
  // one to find the right document. The browser's own PDF viewer renders
  // the first page in the card below, so this needs no rendering library.
  const previewable = files.value.filter((f) => f.storage_path && (f.file_type?.startsWith('image/') || isPdf(f)))
  // One signing request for the lot rather than one per file: a patient with
  // forty scans was forty round trips before a single thumbnail appeared.
  // Matched back by path, since the response is per path, not per row.
  const urls: Record<string, string> = {}
  if (previewable.length > 0) {
    const { data: signed } = await supabase.storage
      .from('patient-files')
      .createSignedUrls([...new Set(previewable.map((f) => f.storage_path!))], 60 * 10)
    const byPath: Record<string, string> = {}
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) byPath[s.path] = s.signedUrl
    for (const f of previewable) if (byPath[f.storage_path!]) urls[f.id] = byPath[f.storage_path!]
  }
  thumbUrls.value = urls
}

function isPdf(file: PatientFile) {
  return file.file_type === 'application/pdf' || /\.pdf$/i.test(file.file_name)
}
function isImage(file: PatientFile) {
  return !!file.file_type?.startsWith('image/')
}
onMounted(load)
// Defense-in-depth alongside practitioner.vue's :key on the charting pane:
// if this component is ever reused for a different patientId without being
// remounted, the file grid should follow rather than silently keep
// displaying the previous patient's files next to the new patient's name.
watch(() => props.patientId, load)

async function updateVisibility(file: PatientFile) {
  await supabase.from('patient_files').update({ visibility: file.visibility }).eq('id', file.id)
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function kindLabel(file: PatientFile) {
  const ext = file.file_name.split('.').pop()?.toUpperCase()
  if (ext && ext.length <= 5) return ext
  const type = file.file_type ?? ''
  if (type.startsWith('image/')) return 'IMG'
  if (type === 'application/pdf') return 'PDF'
  return 'FILE'
}

async function uploadFiles(fileList: FileList) {
  error.value = ''
  uploading.value = true
  // Snapshotted once, up front: this component instance can outlive the
  // upload (My Day keeps a single charting pane mounted across patients --
  // see practitioner.vue). Reading props.patientId again after the storage
  // upload's await, instead of this const, would file the upload under
  // whichever patient happens to be selected by the time it resolves, not
  // whoever it was actually uploaded for.
  const patientId = props.patientId
  for (const file of Array.from(fileList)) {
    const path = `${store.accountId}/${patientId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
    const { error: uploadError } = await supabase.storage.from('patient-files').upload(path, file)
    if (uploadError) {
      error.value = uploadError.message
      continue
    }
    const { data: inserted } = await supabase
      .from('patient_files')
      .insert({
        account_id: store.accountId!,
        patient_id: patientId,
        storage_path: path,
        file_name: file.name,
        file_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: store.teamMember?.id ?? null,
      })
      .select('id')
      .single()
    // Fire-and-forget: the upload itself already succeeded and is visible
    // below, so there's no reason to make the user wait on a background
    // optimization pass. A failure here (network hiccup, an unsupported
    // format) just leaves the file at its original size -- never blocks or
    // breaks the upload.
    if (inserted) useStaffFetch('/api/patients/files/compress', { method: 'POST', body: { fileId: inserted.id } }).catch(() => {})
  }
  uploading.value = false
  if (fileInput.value) fileInput.value.value = ''
  await load()
}

// Through openWhenReady, not window.open after the await: on an iPad that
// open is refused by Safari's popup blocker without a word, and neither
// button did anything at all.
function view(file: Tables<'patient_files'>) {
  const path = file.storage_path
  if (!path) return
  openWhenReady(async () => {
    const { data } = await supabase.storage.from('patient-files').createSignedUrl(path, 60 * 5)
    return data?.signedUrl
  })
}

/**
 * Saves the file rather than opening it. Preview opens a viewer, which for
 * a scan or an X-ray is usually what you want; Download is what you want
 * when it has to go to an insurer or a consultant, and a viewer tab is a
 * poor way to get there.
 */
function download(file: Tables<'patient_files'>) {
  const path = file.storage_path
  if (!path) return
  openWhenReady(async () => {
    const { data } = await supabase.storage
      .from('patient-files')
      .createSignedUrl(path, 60 * 5, { download: file.file_name ?? true })
    return data?.signedUrl
  })
}

// Sends the file into the patient's WhatsApp chat as a PDF that opens only
// with their DNI/NIE -- or a password the clinic tells them when there is no
// DNI on file (88 of 1,598 Columnaquiro patients had one on 3 Oct 2026).
// utils/protectedDocument.ts and /api/patients/files/[id]/send-protected
// have the rest. PDFs and photos only: those are what a phone opens.
function canSendProtected(file: PatientFile) {
  return !!file.storage_path && can('inbox_access') && (isPdf(file) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.file_type ?? ''))
}

const protecting = ref<PatientFile | null>(null)
const protectPatient = ref<{ national_id: string | null; preferred_language: string } | null>(null)
const protectPassword = ref('')
const protectSaveId = ref(false)
const protectCaption = ref('')
const protectCaptionEdited = ref(false)
const protectBusy = ref(false)
const protectError = ref('')

const protectNormalised = computed(() => documentPassword(protectPassword.value))
const storedNationalId = computed(() => (protectPatient.value?.national_id ? documentPassword(protectPatient.value.national_id) : null))
const protectUsesNationalId = computed(() => isSpanishId(protectNormalised.value) && (protectNormalised.value === storedNationalId.value || protectSaveId.value))
const protectCanSaveId = computed(() => !protectPatient.value?.national_id && isSpanishId(protectNormalised.value))
const protectLeaksPassword = computed(() => captionRevealsPassword(protectCaption.value, protectNormalised.value))
const protectReady = computed(() => protectNormalised.value.length >= MIN_DOCUMENT_PASSWORD_LENGTH && !!protectCaption.value.trim() && !protectLeaksPassword.value)

function suggestedCaption() {
  if (!protecting.value) return ''
  return defaultProtectedCaption({ fileName: protecting.value.file_name, passwordIsNationalId: protectUsesNationalId.value, english: protectPatient.value?.preferred_language === 'en' })
}
// The suggested message follows the password (DNI or not) until someone
// writes their own.
watch(protectUsesNationalId, () => {
  if (!protectCaptionEdited.value) protectCaption.value = suggestedCaption()
})

async function openProtect(file: PatientFile) {
  protecting.value = file
  protectError.value = ''
  protectSaveId.value = false
  protectCaptionEdited.value = false
  const { data } = await supabase.from('patients').select('national_id, preferred_language').eq('id', props.patientId).maybeSingle()
  protectPatient.value = data
  protectPassword.value = data?.national_id ? documentPassword(data.national_id) : ''
  protectCaption.value = suggestedCaption()
}

async function sendProtected() {
  const file = protecting.value
  if (!file || !protectReady.value) return
  protectBusy.value = true
  protectError.value = ''
  try {
    await useStaffFetch(`/api/patients/files/${file.id}/send-protected`, {
      method: 'POST',
      body: { password: protectPassword.value, caption: protectCaption.value, saveAsNationalId: protectCanSaveId.value && protectSaveId.value },
    })
    protecting.value = null
    showToast(t('Sent to the patient on WhatsApp, password-protected.', 'Enviado al paciente por WhatsApp, protegido con contraseña.'))
  } catch (err: any) {
    protectError.value = err?.data?.statusMessage ?? t('Could not send the document.', 'No se pudo enviar el documento.')
  } finally {
    protectBusy.value = false
  }
}

// The row first, then the file. It was the other way round, with neither
// result checked: storage lets any member remove an object, but the row needs
// patient_files_delete (and, under own-docs scope, to be theirs) -- so a role
// without it removed the file, had the row refused, and left a file on the
// patient that opens to nothing. Four such rows were found in production on
// 30 Sep 2026. Asked in an in-app dialog rather than confirm().
const deleting = ref<Tables<'patient_files'> | null>(null)
async function confirmRemove() {
  const file = deleting.value
  if (!file) return
  deleting.value = null
  const { data: gone, error: deleteError } = await supabase.from('patient_files').delete().eq('id', file.id).select('id')
  if (deleteError || !gone?.length) {
    error.value = deleteError?.message ?? t('This file was not deleted: your role cannot delete it.', 'No se ha eliminado el archivo: tu rol no puede eliminarlo.')
    return
  }
  if (file.storage_path) await supabase.storage.from('patient-files').remove([file.storage_path])
  files.value = files.value.filter((f) => f.id !== file.id)
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
      <p class="text-[13.5px] font-semibold text-ink-700">
        {{ t('Files uploaded by the clinic', 'Archivos subidos por la clínica') }}
        <span v-if="!loading" class="ml-1 font-normal text-ink-faint">{{ files.length }}</span>
      </p>
      <label class="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Upload file', 'Subir archivo') }}
        <input ref="fileInput" type="file" multiple class="hidden" :disabled="uploading" @change="(e) => uploadFiles((e.target as HTMLInputElement).files!)" />
      </label>
    </div>
    <p v-if="error" class="px-4 pt-3 text-[13px] text-danger-text">{{ error }}</p>

    <div v-if="loading" class="grid grid-cols-1 gap-4 p-4 min-[480px]:grid-cols-2 sm:grid-cols-4">
      <div v-for="i in 4" :key="i" class="overflow-hidden rounded-ctl border border-line-divider bg-surface">
        <UiSkeleton class="h-[104px] w-full rounded-none" />
        <div class="space-y-1.5 p-2.5">
          <UiSkeleton class="h-3 w-full rounded-ctlSm" />
          <UiSkeleton class="h-2.5 w-2/3 rounded-ctlSm" />
        </div>
      </div>
    </div>
    <div v-else-if="files.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No files uploaded yet.', 'Aún no se han subido archivos.') }}</div>
    <div
      v-else
      class="grid grid-cols-1 gap-4 p-4 min-[480px]:grid-cols-2 sm:grid-cols-4"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div v-for="file in files" :key="file.id" class="group overflow-hidden rounded-ctl border border-line-divider bg-surface">
        <div
          class="relative flex h-[104px] w-full items-center justify-center overflow-hidden bg-surface-subtle"
          :style="
            thumbUrls[file.id] && isImage(file)
              ? { backgroundImage: `url(${thumbUrls[file.id]})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : thumbUrls[file.id] && isPdf(file)
                ? {}
                : { backgroundImage: 'repeating-linear-gradient(135deg, #F4F5F8 0px, #F4F5F8 6px, #EDEEF2 6px, #EDEEF2 12px)' }
          "
        >
          <!-- The browser's built-in viewer renders page one. pointer-events
          are off so the whole tile stays a plain card -- the iframe must not
          swallow clicks or scroll -- and the chrome is hidden so it reads as
          a thumbnail rather than an embedded reader. -->
          <iframe
            v-if="thumbUrls[file.id] && isPdf(file)"
            :src="`${thumbUrls[file.id]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`"
            class="pointer-events-none absolute inset-0 h-full w-full border-0"
            loading="lazy"
            tabindex="-1"
            aria-hidden="true"
          ></iframe>
          <span
            v-if="!thumbUrls[file.id]"
            class="rounded-ctlSm bg-surface/90 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-muted2"
          >
            {{ kindLabel(file) }}
          </span>
          <span
            v-else-if="isPdf(file)"
            class="absolute bottom-1.5 left-1.5 rounded-ctlSm bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-muted2"
          >
            PDF
          </span>
          <span v-if="!file.storage_path" class="absolute right-1.5 top-1.5 rounded-pill bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning-text">
            {{ t('Not migrated', 'No migrado') }}
          </span>
        </div>
        <div class="p-2.5">
          <p class="truncate font-mono text-[12px] font-medium text-ink-700" :title="file.file_name">{{ file.file_name }}</p>
          <p class="mt-0.5 truncate text-[11px] text-ink-faint" :title="fileMeta(file)">{{ fileMeta(file) }}</p>
          <!-- Wraps rather than squeezing: two to a row on a phone left the
               select a bare chevron and pushed the delete button out of the
               card. -->
          <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <select
              v-model="file.visibility"
              class="min-w-0 rounded border border-line-control px-1 py-0.5 text-[10.5px] text-ink-muted focus:border-brand focus:outline-none touch:min-h-10"
              :title="t('Whether this file will show to the patient in the mobile app', 'Si este archivo se mostrará al paciente en la aplicación móvil')"
              @change="updateVisibility(file)"
            >
              <option value="generic">{{ t('Generic', 'Genérico') }}</option>
              <option value="custom">{{ t('Custom', 'Personalizado') }}</option>
            </select>
            <div class="flex shrink-0 items-center gap-2">
              <button v-if="file.storage_path" type="button" class="text-[11px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus touch:min-h-10 touch:px-1" @click="view(file)">{{ t('Preview', 'Vista previa') }}</button>
              <button v-if="file.storage_path" type="button" class="text-[11px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus touch:min-h-10 touch:px-1" @click="download(file)">{{ t('Download', 'Descargar') }}</button>
              <UiIconBtn v-if="canSendProtected(file)" icon="lock" data-cy="file-send-protected" :label="t('Send protected by WhatsApp', 'Enviar protegido por WhatsApp')" @click="openProtect(file)" />
              <UiIconBtn v-if="can('patient_files_delete')" icon="trash" tone="danger" data-cy="file-delete" :label="t('Delete', 'Eliminar')" @click="deleting = file" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Dropping onto the card is how people actually file things. The
    button in the header stays, because a dropzone is invisible to anyone
    who does not already know it is there. -->
    <label
      class="m-4 mt-0 flex cursor-pointer flex-col items-center justify-center rounded-ctl border border-dashed px-4 py-5 text-center transition-colors"
      :class="dragging ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface-subtle2'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <span class="text-[12.5px] text-ink-muted2">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Drop files here, or click to choose', 'Suelta archivos aquí, o haz clic para elegir') }}
      </span>
      <input type="file" multiple class="hidden" :disabled="uploading" @change="(e) => uploadFiles((e.target as HTMLInputElement).files!)" />
    </label>
    <UiConfirmDialog
      v-if="protecting"
      :title="t('Send protected by WhatsApp', 'Enviar protegido por WhatsApp')"
      :confirm-label="protectBusy ? t('Sending…', 'Enviando…') : t('Send', 'Enviar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="protectBusy"
      :disabled="!protectReady"
      @confirm="sendProtected"
      @cancel="protecting = null"
    >
      <div class="space-y-3 text-[13.5px] text-ink-700" data-cy="send-protected-dialog">
        <p class="leading-snug">
          {{ t(`${protecting.file_name} goes to the patient's WhatsApp as a PDF that only opens with this password.`, `${protecting.file_name} se envía al WhatsApp del paciente como un PDF que solo se abre con esta contraseña.`) }}
        </p>
        <label class="block">
          <span class="text-[12.5px] font-medium text-ink-700">{{ t('Password', 'Contraseña') }}</span>
          <input
            v-model="protectPassword"
            type="text"
            autocomplete="off"
            spellcheck="false"
            data-cy="send-protected-password"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 font-mono text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <span class="mt-1 block text-[12px] text-ink-muted2">
            <template v-if="storedNationalId && protectNormalised === storedNationalId">{{ t('Their DNI/NIE on file.', 'Su DNI/NIE guardado.') }}</template>
            <template v-else-if="!protectPatient?.national_id">{{ t('No DNI/NIE saved for this patient. Type it, or a password you will tell them in person or by phone.', 'Este paciente no tiene DNI/NIE guardado. Escríbelo, o una contraseña que le dirás en persona o por teléfono.') }}</template>
            <template v-else>{{ t('Not the DNI/NIE on file: tell the patient this password yourself.', 'No es el DNI/NIE guardado: dile tú esta contraseña al paciente.') }}</template>
          </span>
        </label>
        <label v-if="protectCanSaveId" class="flex items-center gap-2 text-[12.5px]">
          <input v-model="protectSaveId" type="checkbox" class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
          {{ t("Save it as this patient's DNI/NIE", 'Guardarlo como DNI/NIE del paciente') }}
        </label>
        <label class="block">
          <span class="text-[12.5px] font-medium text-ink-700">{{ t('Message', 'Mensaje') }}</span>
          <textarea
            v-model="protectCaption"
            rows="3"
            data-cy="send-protected-caption"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @input="protectCaptionEdited = true"
          ></textarea>
          <span v-if="protectLeaksPassword" class="mt-1 block text-[12px] text-danger-text">{{ t('The message must not contain the password.', 'El mensaje no puede incluir la contraseña.') }}</span>
        </label>
        <p class="text-[12px] leading-snug text-ink-muted2">
          {{ t('WhatsApp only allows this within 24 hours of the patient\'s last message to you.', 'WhatsApp solo lo permite en las 24 horas siguientes al último mensaje del paciente.') }}
        </p>
        <p v-if="protectError" class="text-[12.5px] text-danger-text" data-cy="send-protected-error">{{ protectError }}</p>
      </div>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete ${deleting.file_name}?`, `¿Eliminar ${deleting.file_name}?`)"
      :confirm-label="t('Delete file', 'Eliminar archivo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmRemove"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('It is removed from this patient for everyone, and cannot be recovered.', 'Se elimina de este paciente para todos, y no se puede recuperar.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
