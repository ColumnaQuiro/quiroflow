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

/**
 * ClaveRegimen -- L8A. "01: Operación de régimen general."
 *
 * Not marked mandatory in the record design, and rejected when absent:
 *
 *   1245  Si el campo Impuesto está vacío o tiene valor IVA(01) o IPSI(02)
 *         o IGIC(03) el campo ClaveRegimen debe de estar cumplimentado.
 *
 * Impuesto is omitted here, which means IVA by default, which makes this
 * conditionally required. That rule lives in the validation document rather
 * than the record design, so nothing in the field list suggests it -- the
 * AEAT's preproduction service is what said so, on the first submission.
 *
 * General regime is right for the clinic even though its work is exempt:
 * the exemption is expressed by OperacionExenta, not by the regime. The two
 * describe different things, and a clinic in the Canaries under IGIC would
 * need a different value here.
 */
const CLAVE_REGIMEN_GENERAL = '01'

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
    /**
     * The patient the factura is for, used when the factura carries no frozen
     * recipient of its own -- which is the normal case, since the recipient is
     * resolved at render time so a NIF collected next week appears on a
     * document issued today.
     */
    patientName?: string | null
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

/**
 * FechaHoraHusoGenRegistro, formatted the way the huella was computed.
 *
 * This is not cosmetic. The AEAT recomputes the huella from the fields in the
 * XML, so the timestamp here must be byte-identical to the one that went into
 * the hash -- and what went in is defined by factura_huella_input(): local
 * Spanish time, whole seconds, offset spelled out.
 *
 *   hashed:   2026-09-18T09:09:39+02:00
 *   postgres: 2026-09-18 07:09:39.571153+00
 *
 * Sending the second would have been rejected on every record, with an error
 * about the huella rather than about the date -- and the huella would look
 * wrong while being perfectly correct. Found by diffing a dry-run envelope
 * against factura_huella_input()'s own output before the first submission.
 *
 * Europe/Madrid rather than the stored offset, because that is the zone the
 * database function pins itself to. Peninsular Spain is what the clinic is
 * in; a Canary clinic would hash under a different offset and this would have
 * to follow whatever the function does.
 */
export function aeatDateTime(iso: string): string {
  const d = new Date(iso)
  const tz = 'Europe/Madrid'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  // "GMT+02:00" in summer, "GMT+01:00" in winter -- read from the zone rather
  // than assumed, so the change of season does not silently break the hash.
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value
  const offset = (tzName ?? 'GMT+00:00').replace('GMT', '') || '+00:00'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
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
        // Before the exemption: the record design orders ClaveRegimen ahead
        // of the calificación/exenta pair, and the AEAT validates the order.
        L('ClaveRegimen', CLAVE_REGIMEN_GENERAL),
        L('OperacionExenta', factura.taxExemptionCode as string),
        L('BaseImponibleOimporteNoSujeto', money(factura.taxBaseCents)),
      ]
    : [
        L('ClaveRegimen', CLAVE_REGIMEN_GENERAL),
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
  //
  // A recipient name is required once the block is present, and an empty one
  // is refused: "1100 Valor o tipo incorrecto del campo.: NombreRazon". Every
  // F1 and R1 this clinic has issued carries recipient_name NULL, because the
  // name resolves from the patient when the document is rendered rather than
  // being copied onto the factura -- so the sender has to resolve it the same
  // way rather than sending the empty string it finds.
  const recipientName = capped((factura.recipientName || factura.patientName || '').trim(), 120)
  const destinatarios =
    record.invoiceType === 'F2' || !recipientName
      ? []
      : [
          '<sum1:Destinatarios>',
          '<sum1:IDDestinatario>',
          L('NombreRazon', recipientName),
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
    // Both, or neither. The AEAT refuses RechazoPrevio on its own:
    //
    //   1161  no podrá incluirse el campo RechazoPrevio con valor S si no se
    //         ha informado del campo Subsanacion o tiene el valor N
    //
    // Which the record design says too, in RechazoPrevio's own description --
    // "un nuevo registro de facturación de alta SUBSANADO tras haber sido
    // rechazado". A resend after rejection is a subsanación that also happens
    // to follow a rejection; it is not a third thing. #330 sent the second
    // flag without the first and every retry was refused.
    ...(input.afterRejection ? [L('Subsanacion', 'S'), L('RechazoPrevio', 'S')] : []),
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
    L('FechaHoraHusoGenRegistro', aeatDateTime(record.generatedAt)),
    L('TipoHuella', TIPO_HUELLA_SHA256),
    L('Huella', record.huella),
    // No Signature element. The record design says it is "obligatorio para
    // conservación y para requerimiento, pero no para remisión voluntaria
    // «VERI*FACTU»" -- transmitting is what replaces it, and it is the reason
    // this system has no XAdES signing and no registro de eventos.
    '</sum1:RegistroAlta>',
  ].join('')
}
