import { EMAIL_MERGE_FIELDS, say } from '~/utils/automationCatalog'

// The example patient every email preview is filled with, and the merge
// fields an email step offers, in one place for the step's drawer and the
// full-screen email editor. The real values arrive per patient at send time.

const SAMPLE: Record<string, string> = {
  first_name: 'Lucía',
  last_name: 'García',
  email: 'lucia@ejemplo.com',
  next_appointment: 'jueves 16 de octubre, 10:00',
  appointment_date: 'jueves 16 de octubre',
  appointment_time: '10:00',
  google_review_link: 'https://g.page/r/ejemplo/review',
  satisfaction_link: 'https://app.quiroflow.com/valorar/ejemplo',
  waitlist_claim_link: 'https://app.quiroflow.com/w/ejemplo',
  waitlist_slot_datetime: 'viernes 17, 18:30',
  invoice_number: 'F-2026-0142',
  invoice_amount_owed: '45,00 €',
  invoice_pay_link: 'https://app.quiroflow.com/api/pay/ejemplo',
  practitioner_first_name: 'Ana',
  last_visit_month: 'julio',
  referred_first_name: 'Marta',
}

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function useMergeSamples() {
  const t = useT()
  const b = useBuilder()
  const store = useAccountStore()
  const supabase = useSupabaseClient()

  const clinicName = computed(() => store.currentClinic?.name ?? '')
  const logoUrl = computed(() => {
    const path = store.currentClinic?.logo_storage_path ?? store.clinics.find((c) => c.logo_storage_path)?.logo_storage_path
    return path ? supabase.storage.from('clinic-logos').getPublicUrl(path).data.publicUrl : null
  })
  const bookingUrl = computed(() => (store.accountSlug && import.meta.client ? `${window.location.origin}/book/${store.accountSlug}` : 'https://app.quiroflow.com/book/clinica-demo'))

  function sample(key: string): string {
    if (key === 'clinic_name') return clinicName.value
    if (key === 'clinic_phone') return '+34 600 000 000'
    if (key === 'clinic_address') return store.currentClinic?.address ?? ''
    if (key === 'booking_link') return bookingUrl.value
    return SAMPLE[key] ?? `[${key}]`
  }
  /** Merge fields filled with the example, the values escaped as the send escapes them. */
  const fillHtml = (html: string) => html.replace(/\{\{(\w+)\}\}/g, (_, k: string) => escapeHtml(sample(k)))
  const fillText = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => sample(k))

  // A lead automation can also merge in what the lead answered on their
  // form, one per question ({{answer_…}}), shortened so a long question does
  // not crowd the picker.
  const short = (s: string) => (s.length > 40 ? s.slice(0, 39).trimEnd() + '…' : s)
  const fields = computed(() => [
    ...EMAIL_MERGE_FIELDS.map((f) => ({ key: f.value, label: say(t, f.label), group: f.group, sample: sample(f.value) })),
    ...(b.isLead.value ? b.leadQuestions.value.map((q) => ({ key: q.key, label: short(q.question), group: 'lead' as const })) : []),
  ])

  return { sample, fillHtml, fillText, fields, clinicName, logoUrl, bookingUrl }
}
