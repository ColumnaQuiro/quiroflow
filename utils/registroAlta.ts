// Turning a registro de facturación into the XML the AEAT expects.
//
// Builds the RegistroAlta element only -- no SOAP envelope, no transport, no
// certificate. Those come next and need things we do not have yet. What this
// does is the part that has to be exactly right and can be checked without
// sending anything: which fields appear, which do not, and in what shape.
//
// Every field, length and code list here comes from AEAT's own record design
// (DsRegistroVeriFactu.xlsx, sheet «2)D. Registro Facturación Alta» and
// «6)Listas»), not from a vendor summary or from SII by analogy.
import {
  SIF_CODE,
  SIF_ONLY_VERIFACTU,
  SIF_PRODUCER,
  SIF_SUPPORTS_MULTIPLE_OBLIGADOS,
  SIF_SYSTEM_NAME,
  SIF_VERSION,
  sifInstallationNumber,
} from './sifIdentity'

/** L15. The schema version, not ours. */
const ID_VERSION = '1.0'

/** L12. The only value: SHA-256, which is what the chain already uses. */
const TIPO_HUELLA_SHA256 = '01'

export interface RegistroAltaInput {
  /** The immutable record. Its huella is what the AEAT will check. */
  record: {
    issuerNif: string
    serieNumber: string
    /** ISO date, as stored (YYYY-MM-DD). */
    issuedOn: string
    invoiceType: string
    cuotaTotalCents: number
    importeTotalCents: number
    generatedAt: string
    previousHuella: string | null
    huella: string
  }
  /** The predecessor, needed in full for Encadenamiento -- not just its huella. */
  previousRecord: {
    issuerNif: string
    serieNumber: string
    issuedOn: string
  } | null
  /** Details that live on the factura rather than the record. */
  factura: {
    description: string
    taxBaseCents: number
    taxRateBp: number
    taxAmountCents: number
    taxExemptionCode: string | null
    recipientName: string | null
    recipientNif: string | null
  }
  issuerName: string
  accountId: string
  /**
   * Derived by the database, never configured -- see
   * sif_indicador_multiples_ot(). Passed in rather than read here so this
   * stays a pure function.
   */
  indicadorMultiplesOt: string
  /**
   * "S" when this record is going again after the AEAT rejected the previous
   * attempt. The record itself is unchanged and keeps its huella; this only
   * tells the AEAT the resend is deliberate rather than a duplicate.
   *
   * Only ever set from a stored submission whose status was 'Incorrecto'. A
   * record rejected at the AEAT was never registered there, so it goes back
   * as an ordinary alta with this flag -- not as a subsanación, which is for
   * correcting a record they DID register.
   */
  afterRejection?: boolean
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Decimal (12,2). Cents are the truth; this is only the presentation. */
const money = (cents: number) => (cents / 100).toFixed(2)

/** AEAT wants dd-mm-yyyy, while everything internal is ISO. */
export function aeatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

/** Decimal (3,2) -- 21 % is "21.00", and an exempt operation has no rate. */
const rate = (bp: number) => (bp / 100).toFixed(2)

/**
 * Truncated to the length the AEAT allows rather than sent long.
 *
 * A description over 500 characters is not a reason to fail a fiscal record:
 * the record's own huella is computed from the total and the number, not from
 * this text, so trimming it changes nothing that is checked. Sending it long
 * would have the record rejected outright.
 */
const capped = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max))

export function buildRegistroAlta(input: RegistroAltaInput): string {
  const { record, previousRecord, factura, issuerName, accountId } = input
  const L = (tag: string, value: string) => `<sum1:${tag}>${esc(value)}</sum1:${tag}>`

  // Desglose. CalificacionOperacion and OperacionExenta are ALTERNATIVES --
  // the record design marks both with the "campo de selección (alternativo)"
  // fill, so exactly one of them belongs in a line. An exempt operation
  // carries OperacionExenta and no CalificacionOperacion; sending both is
  // rejected, and sending neither is too.
  //
  // The clinic's work is exempt under article 20 (E1), so in practice this
  // takes the exempt branch for every record it has ever produced. The other
  // branch exists because the exemption is per-account configuration, not a
  // property of the software.
  const exempt = Boolean(factura.taxExemptionCode)
  const detalle = exempt
    ? [
        L('OperacionExenta', factura.taxExemptionCode as string),
        L('BaseImponibleOimporteNoSujeto', money(factura.taxBaseCents)),
      ]
    : [
        // S1: subject and not exempt, without reverse charge. The clinic sells
        // treatment to patients; nothing here is a reverse-charge operation.
        L('CalificacionOperacion', 'S1'),
        L('TipoImpositivo', rate(factura.taxRateBp)),
        L('BaseImponibleOimporteNoSujeto', money(factura.taxBaseCents)),
        L('CuotaRepercutida', money(factura.taxAmountCents)),
      ]

  // Encadenamiento. Either this is the first record this system generated for
  // the issuer, or it names its predecessor in full -- the AEAT re-walks the
  // chain, so the huella alone is not enough to identify what came before.
  const encadenamiento = previousRecord
    ? [
        '<sum1:RegistroAnterior>',
        L('IDEmisorFactura', previousRecord.issuerNif),
        L('NumSerieFactura', previousRecord.serieNumber),
        L('FechaExpedicionFactura', aeatDate(previousRecord.issuedOn)),
        L('Huella', record.previousHuella ?? ''),
        '</sum1:RegistroAnterior>',
      ]
    : [L('PrimerRegistro', 'S')]

  // Destinatarios is required for a full invoice and must be absent from a
  // simplificada, which is the whole point of the distinction: F2 is the one
  // that does not identify the customer.
  const destinatarios =
    record.invoiceType === 'F2'
      ? []
      : [
          '<sum1:Destinatarios>',
          '<sum1:IDDestinatario>',
          L('NombreRazon', capped(factura.recipientName ?? '', 120)),
          ...(factura.recipientNif ? [L('NIF', factura.recipientNif)] : []),
          '</sum1:IDDestinatario>',
          '</sum1:Destinatarios>',
        ]

  return [
    '<sum1:RegistroAlta>',
    L('IDVersion', ID_VERSION),
    '<sum1:IDFactura>',
    L('IDEmisorFactura', record.issuerNif),
    L('NumSerieFactura', record.serieNumber),
    L('FechaExpedicionFactura', aeatDate(record.issuedOn)),
    '</sum1:IDFactura>',
    L('NombreRazonEmisor', capped(issuerName, 120)),
    ...(input.afterRejection ? [L('RechazoPrevio', 'S')] : []),
    L('TipoFactura', record.invoiceType),
    L('DescripcionOperacion', capped(factura.description, 500)),
    ...destinatarios,
    '<sum1:Desglose>',
    '<sum1:DetalleDesglose>',
    ...detalle,
    '</sum1:DetalleDesglose>',
    '</sum1:Desglose>',
    L('CuotaTotal', money(record.cuotaTotalCents)),
    L('ImporteTotal', money(record.importeTotalCents)),
    '<sum1:Encadenamiento>',
    ...encadenamiento,
    '</sum1:Encadenamiento>',
    '<sum1:SistemaInformatico>',
    L('NombreRazon', SIF_PRODUCER.name),
    L('NIF', SIF_PRODUCER.nif),
    L('NombreSistemaInformatico', SIF_SYSTEM_NAME),
    L('IdSistemaInformatico', SIF_CODE),
    L('Version', SIF_VERSION),
    L('NumeroInstalacion', sifInstallationNumber(accountId)),
    L('TipoUsoPosibleSoloVerifactu', SIF_ONLY_VERIFACTU),
    L('TipoUsoPosibleMultiOT', SIF_SUPPORTS_MULTIPLE_OBLIGADOS),
    L('IndicadorMultiplesOT', input.indicadorMultiplesOt),
    '</sum1:SistemaInformatico>',
    L('FechaHoraHusoGenRegistro', record.generatedAt),
    L('TipoHuella', TIPO_HUELLA_SHA256),
    L('Huella', record.huella),
    // No Signature element. The record design says it is "obligatorio para
    // conservación y para requerimiento, pero no para remisión voluntaria
    // «VERI*FACTU»" -- transmitting is what replaces it, and it is the reason
    // this system has no XAdES signing and no registro de eventos.
    '</sum1:RegistroAlta>',
  ].join('')
}
