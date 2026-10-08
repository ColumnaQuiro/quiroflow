import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import QRCode from 'qrcode'
import { exemptionClause } from '~/utils/facturaTax'
import { verifactuQrUrl } from '~/utils/verifactuQr'

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
      'number, kind, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, issued_at, account_id, patient_id, recipient_name, recipient_nif, recipient_address, rectifies_factura_id, issuer_name, issuer_legal_name, issuer_address, issuer_tax_id, issuer_footer_text, issuer_logo_storage_path, patients(first_name, last_name, email, address, city, postal_code, country, national_id)',
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

  // The issuer is printed from the snapshot taken when the factura was issued
  // (fill_factura_issuer, 20260924135318), never from the clinic as it is
  // now: an issued factura is a fiscal record, and editing the clinic's
  // address or NIF in Settings must not rewrite documents already handed
  // over. The same snapshot also names the right clinic on a multi-clinic
  // account -- the visit's, not simply the oldest.
  //
  // Every row existing at that migration was backfilled, so the live read
  // below is only a fallback for a factura issued while the account had no
  // clinic at all.
  const issuer = factura.issuer_name
    ? {
        name: factura.issuer_name,
        legalName: factura.issuer_legal_name,
        address: factura.issuer_address,
        taxId: factura.issuer_tax_id,
        footerText: factura.issuer_footer_text,
        logoStoragePath: factura.issuer_logo_storage_path,
      }
    : await liveIssuer(supabase, factura.account_id)

  let logoBuffer: Buffer | null = null
  if (issuer?.logoStoragePath) {
    try {
      const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(issuer.logoStoragePath)
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
  const verifactuQr = await verifactuQrFor(supabase, facturaId)

  const frozenName = factura.recipient_name
  const [frozenFirst, ...frozenRest] = (frozenName ?? '').split(' ')

  return {
    accountId: factura.account_id,
    patientId: factura.patient_id,
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
    clinic: issuer
      ? { name: issuer.name, legalName: issuer.legalName, address: issuer.address, taxId: issuer.taxId, footerText: issuer.footerText }
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
    verifactuQr,
  }
}

// The factura's VERI*FACTU QR, from its registro -- see utils/verifactuQr.ts
// for why the record and not the factura.
//
// Only on a factura whose record is in the PRODUCTION chain, i.e. one issued
// after the clinic went live. A test-chain factura is a real document handed
// to a real patient, and on it the QR would open the AEAT's test portal
// (Portal de Pruebas Externas) and the "VERI*FACTU" legend would claim a
// status the factura does not have -- Columnaquiro's 2026 facturas are not
// VERI*FACTU facturas; its 2027 ones are. Decided 28 Sep 2026.
async function verifactuQrFor(supabase: SupabaseClient<Database>, facturaId: string) {
  const { data: record } = await supabase
    .from('factura_records')
    .select('issuer_nif, serie_number, issued_on, importe_total_cents, environment')
    .eq('factura_id', facturaId)
    .eq('record_type', 'alta')
    .maybeSingle()
  if (!record || record.environment !== 'production' || !record.issuer_nif) return null

  const url = verifactuQrUrl({
    issuerNif: record.issuer_nif,
    serieNumber: record.serie_number,
    issuedOn: record.issued_on,
    importeTotalCents: record.importe_total_cents,
    environment: 'production',
  })
  const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 0, width: 600, type: 'png' })
  return { url, png }
}

// The pre-snapshot behaviour: the account's first clinic, read now.
async function liveIssuer(supabase: SupabaseClient<Database>, accountId: string) {
  const { data: clinicRow } = await supabase
    .from('clinics')
    .select('name, legal_name, address, tax_id, invoice_footer_text, logo_storage_path')
    .eq('account_id', accountId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!clinicRow) return null
  return {
    name: clinicRow.name,
    legalName: clinicRow.legal_name,
    address: clinicRow.address,
    taxId: clinicRow.tax_id,
    footerText: clinicRow.invoice_footer_text,
    logoStoragePath: clinicRow.logo_storage_path,
  }
}
