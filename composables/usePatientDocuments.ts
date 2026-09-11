// Documents the clinic has deliberately shared with this patient, and the
// signed URL that opens one.
//
// The list is not filtered here: "patients view own custom patient_files"
// (0162) already restricts the table to visibility = 'custom' rows with a
// storage_path, so this selects everything it can see. A front-end filter
// would be a second copy of that rule, and the weaker of the two.
//
// Extracted from components/patient/FilesCard.vue so the portal's
// documents page and the mobile card open files the same way.
export interface PatientDocumentRow {
  id: string
  file_name: string
  file_type: string | null
  size_bytes: number | null
  created_at: string
}

export function usePatientDocuments(patientId: () => string) {
  const supabase = useSupabaseClient()
  const authedFetch = useAuthedFetch()
  const t = useT()
  const { showToast } = useToast()

  const documents = ref<PatientDocumentRow[]>([])
  const loading = ref(true)
  const busyId = ref<string | null>(null)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const { data } = await supabase
      .from('patient_files')
      .select('id, file_name, file_type, size_bytes, created_at')
      .eq('patient_id', id)
      .order('created_at', { ascending: false })
    documents.value = data ?? []
    loading.value = false
  }

  async function open(file: PatientDocumentRow) {
    busyId.value = file.id
    try {
      const { url } = await authedFetch<{ url: string }>('/api/patient-files/signed-url', {
        method: 'POST',
        body: { fileId: file.id },
      })
      // A new tab rather than an <a download>: on iOS the app runs in a
      // WKWebView where a download attribute does nothing, and the system
      // viewer handling a PDF is what a patient expects anyway.
      window.open(url, '_blank')
    } catch (err: unknown) {
      const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      showToast(message ?? t('Could not open that file.', 'No se pudo abrir el archivo.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  watch(patientId, load, { immediate: true })

  return { documents, loading, busyId, open, reload: load }
}

export function fileSizeLabel(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
