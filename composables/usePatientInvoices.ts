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

  // Fetched as a blob and handed to the browser, rather than opening the
  // endpoint in a new tab: the PDF route authenticates by bearer token, and
  // a plain window.open sends no Authorization header at all.
  async function download(invoice: PatientInvoiceRow) {
    busyId.value = invoice.id
    try {
      const blob = await authedFetch<Blob>(`/api/patient-invoices/pdf?id=${invoice.id}`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${invoice.invoice_number ?? 'invoice'}.pdf`
      link.click()
      URL.revokeObjectURL(url)
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
