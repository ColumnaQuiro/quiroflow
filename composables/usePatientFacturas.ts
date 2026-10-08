// A patient's facturas, and the PDF behind each one.
//
// The twin of usePatientInvoices. They stay separate because they are separate
// things: an invoice row is a CHARGE, one per visit, and what drives the
// balance; a factura is the fiscal document, one per payment. Showing a
// patient both in one list was the confusion this whole change removes.
export interface PatientFacturaRow {
  id: string
  number: string
  kind: string
  description: string
  amount_cents: number
  issued_at: string
}

export function usePatientFacturas(patientId: () => string) {
  const supabase = useSupabaseClient()
  const authedFetch = useAuthedFetch()
  const t = useT()
  const { showToast } = useToast()

  const facturas = ref<PatientFacturaRow[]>([])
  const loading = ref(true)
  // A failed read keeps what was shown and says so, rather than reading as
  // an empty list.
  const loadError = ref(false)
  const busyId = ref<string | null>(null)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const { data, error } = await supabase
      .from('facturas')
      .select('id, number, kind, description, amount_cents, issued_at')
      .eq('patient_id', id)
      .order('issued_at', { ascending: false })
      .limit(200)
    loading.value = false
    loadError.value = !!error
    if (error) return
    facturas.value = data ?? []
  }

  // A URL rather than bytes, for the same reason as an invoice: the patient
  // app is a WKWebView where a blob URL goes nowhere.
  async function download(factura: PatientFacturaRow) {
    busyId.value = factura.id
    try {
      await openWhenReady(async () => {
        const { url } = await authedFetch<{ url: string }>('/api/patient-facturas/pdf-link', {
          method: 'POST',
          body: { facturaId: factura.id },
        })
        return url
      })
    } catch {
      showToast(t('Could not download that factura.', 'No se pudo descargar la factura.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  watch(patientId, load, { immediate: true })

  return { facturas, loading, loadError, busyId, download, reload: load }
}
