// The QR every factura from a VERI*FACTU system must carry (Orden
// HAC/1177/2024 arts. 20-21), pointing at the AEAT's cotejo service, where
// the patient can check the factura was registered.
//
// Built from the factura's REGISTRO rather than from the factura: the record
// is what the AEAT holds, so the four values the service compares -- NIF,
// serie + número, fecha de expedición, importe total -- must be exactly the
// ones that were transmitted. Reading them from anywhere else is how a QR
// ends up saying "not found" about a factura that is registered.
//
// Spec: AEAT "Características del QR y especificaciones del servicio de
// cotejo" v0.5.0 (DetalleEspecificacTecnCodigoQRfactura.pdf):
// - URL per environment below; QuiroFlow only issues verificable facturas
//   (TipoUsoPosibleSoloVerifactu = S), so it is always ValidarQR, never the
//   ValidarQRNoVerifactu variant.
// - Exactly four parameters, URL-encoded as UTF-8: an "&" in a serie number
//   must reach the service as %26, not start a fifth parameter.
// - fecha as DD-MM-AAAA; importe with a "." and at most two decimals.
// - Never the optional `formato=json`: the AEAT forbids it in the QR itself.
//
// Printed only on production facturas (server/utils/facturaData.ts): a
// test-chain factura gets no QR. The test URL stays here because the builder
// is the same and the spec defines it; nothing prints it on a document.

export const VERIFACTU_QR_BASE_URL = {
  production: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
  test: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
} as const

export interface VerifactuQrRecord {
  issuerNif: string
  serieNumber: string
  /** YYYY-MM-DD, as factura_records.issued_on stores it. */
  issuedOn: string
  importeTotalCents: number
  environment: 'test' | 'production'
}

export function verifactuQrUrl(record: VerifactuQrRecord): string {
  const [year, month, day] = record.issuedOn.slice(0, 10).split('-')
  const params = [
    ['nif', record.issuerNif],
    ['numserie', record.serieNumber],
    ['fecha', `${day}-${month}-${year}`],
    // The same formatting the registro's ImporteTotal uses (registroAlta.ts),
    // so the QR says precisely what was transmitted.
    ['importe', (record.importeTotalCents / 100).toFixed(2)],
  ]
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `${VERIFACTU_QR_BASE_URL[record.environment]}?${query}`
}

/** Printed right below the code on every verificable factura. */
export const VERIFACTU_QR_LEGEND = 'VERI*FACTU'
/** Printed right above it, so it is told apart from any other QR. */
export const VERIFACTU_QR_LABEL = 'QR tributario:'
