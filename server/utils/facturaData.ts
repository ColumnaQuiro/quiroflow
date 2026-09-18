import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { exemptionClause } from '~/utils/facturaTax'

// The document the patient is actually given: one per payment, describing what
// the money bought.
//
// It borrows InvoiceDocumentData and generateInvoicePdf wholesale rather than
// growing a second PDF layout. The clinic header, the logo, the address block
// and the footer are identical on both, and two copies of that would drift --
// the parts that genuinely differ are the title, a single line item, and the
// absence of a balance, all of which the shared shape now carries.
const FACTURA_TITLES: Record<string, string> = {
  simplified: 'Factura simplificada',
  full: 'Factura',
  rectificativa: 'Factura rectificativa',
}

export async function loadFacturaDocumentData(
  supabase: SupabaseClient<Database>,
  facturaId: string,
): Promise<InvoiceDocumentData | null> {
  const { data: factura } = await supabase
    .from('facturas')
    .select(
      'number, kind, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, issued_at, account_id, patient_id, recipient_name, recipient_nif, recipient_address, rectifies_factura_id, patients(first_name, last_name, email, address, city, postal_code, country, national_id)',
    )
    .eq('id', facturaId)
    .maybeSingle()
  if (!factura) return null

  const patient = factura.patients as unknown as {
    first_name: string
    last_name: string | null
    email: string | null
    address: string | null
    city: string | null
    postal_code: string | null
    country: string | null
    national_id: string | null
  } | null

  // A package or membership sale has no appointment behind it, so the clinic
  // is the account's first -- accurate for the single-clinic case, which is
  // every account today.
  const { data: clinicRow } = await supabase
    .from('clinics')
    .select('name, legal_name, address, tax_id, invoice_footer_text, logo_storage_path')
    .eq('account_id', factura.account_id)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  let logoBuffer: Buffer | null = null
  if (clinicRow?.logo_storage_path) {
    try {
      const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(clinicRow.logo_storage_path)
      const res = await fetch(publicUrl.publicUrl)
      if (res.ok) logoBuffer = Buffer.from(await res.arrayBuffer())
    } catch {
      logoBuffer = null
    }
  }

  // Recipient details resolve from the patient unless the factura carries its
  // own. That is what lets a NIF collected next week appear on a document
  // issued today -- and what lets a delivered one be frozen so it stops
  // changing under the patient's feet.
  const frozenName = factura.recipient_name
  const [frozenFirst, ...frozenRest] = (frozenName ?? '').split(' ')

  return {
    invoiceNumber: factura.number,
    createdAt: factura.issued_at,
    totalCents: factura.amount_cents,
    // A factura documents money that has already changed hands.
    paidCents: factura.amount_cents,
    balanceDueCents: 0,
    lineItems: [{ description: factura.description, quantity: 1, price_cents: factura.amount_cents }],
    patient: {
      firstName: frozenName ? frozenFirst : (patient?.first_name ?? ''),
      lastName: frozenName ? frozenRest.join(' ') || null : (patient?.last_name ?? null),
      email: patient?.email ?? null,
      address: factura.recipient_address ?? patient?.address ?? null,
      city: factura.recipient_address ? null : (patient?.city ?? null),
      postalCode: factura.recipient_address ? null : (patient?.postal_code ?? null),
      country: factura.recipient_address ? null : (patient?.country ?? null),
      nationalId: factura.recipient_nif ?? patient?.national_id ?? null,
    },
    clinic: clinicRow
      ? { name: clinicRow.name, legalName: clinicRow.legal_name, address: clinicRow.address, taxId: clinicRow.tax_id, footerText: clinicRow.invoice_footer_text }
      : null,
    logoBuffer,
    // A factura is not a reminder to come back; it is a receipt.
    nextAppointmentDate: null,
    hideNextVisit: true,
    // A rectificativa has to say so on its face -- that is most of what makes
    // it one, rather than a factura with a minus sign.
    documentTitle: `${FACTURA_TITLES[factura.kind] ?? 'Factura'} ${factura.number}`,
    showTotalsBreakdown: false,
    tax: {
      baseCents: factura.tax_base_cents ?? factura.amount_cents,
      rateBp: factura.tax_rate_bp ?? 0,
      amountCents: factura.tax_amount_cents ?? 0,
      exemptionClause: exemptionClause(factura.tax_exemption_code),
    },
  }
}
