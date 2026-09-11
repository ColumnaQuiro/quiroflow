// A patient's invoices, and the PDF behind each one.
//
// Extracted from components/patient/InvoicesCard.vue when the portal grew
// a billing page: the query and the status vocabulary are the same on both
// front ends, and "void" meaning "this was cancelled, you owe nothing" is
// worth stating once.
export interface PatientInvoiceRow {
  id: string
  invoice_number: string | null
  total_cents: number
  status: string
  created_at: string
}

export function usePatientInvoices(patientId: () => string) {
  const supabase = useSupabaseClient()
  const authedFetch = useAuthedFetch()
  const t = useT()
  const { showToast } = useToast()

  const invoices = ref<PatientInvoiceRow[]>([])
  const loading = ref(true)
  const busyId = ref<string | null>(null)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_cents, status, created_at')
      .eq('patient_id', id)
      .order('created_at', { ascending: false })
      .limit(200)
    invoices.value = data ?? []
    loading.value = false
  }

  // Opened as a URL, not fetched as a blob: the patient app is a
  // WKWebView, where a download attribute does nothing and a blob URL in a
  // new tab goes nowhere. The server hands back a short-lived signed link
  // and the system viewer takes it -- the same path a clinic-shared file
  // already takes (see usePatientDocuments).
  async function download(invoice: PatientInvoiceRow) {
    busyId.value = invoice.id
    try {
      const { url } = await authedFetch<{ url: string }>('/api/patient-invoices/pdf-link', {
        method: 'POST',
        body: { invoiceId: invoice.id },
      })
      window.open(url, '_blank')
    } catch {
      showToast(t('Could not download that invoice.', 'No se pudo descargar la factura.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  watch(patientId, load, { immediate: true })

  return { invoices, loading, busyId, download, reload: load }
}

export const PATIENT_INVOICE_STATUS: Record<string, { chip: string; label: [string, string] }> = {
  paid: { chip: 'bg-success-bg text-success-text', label: ['Paid', 'Pagada'] },
  unpaid: { chip: 'bg-danger-bg text-danger-text', label: ['Unpaid', 'Pendiente'] },
  void: { chip: 'bg-chip-bg text-chip-text', label: ['Void', 'Anulada'] },
}
