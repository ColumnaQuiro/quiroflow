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
    /** The patient's NIF, for the same reason as patientName. */
    patientNif?: string | null
  }
  /**
   * The factura this one corrects, for FacturasRectificadas. Set only on a
   * rectificativa, and read from facturas.rectifies_factura_id -- which is
   * populated when the refunded payment had exactly one factura behind it.
   */
  rectifies?: {
    issuerNif: string
    serieNumber: string
    /** ISO date, as stored (YYYY-MM-DD). */
    issuedOn: string
  } | null
  issuerName: string
  accountId: string
  /**
   * Derived by the database, never configured -- see
   * sif_indicador_multiples_ot(). Passed in rather than read here so this
   * stays a pure function.
   */
  indicadorMultiplesOt: string
  /**
   * "S" when this record CORRECTS ONE THE AEAT ALREADY HOLDS -- Subsanacion
   * and RechazoPrevio together, which is the only combination the AEAT
   * accepts (1161: RechazoPrevio without Subsanacion is refused).
   *
   * Named for what it asserts rather than for when it is sent, because the
   * previous name -- afterRejection -- described an occasion, and the sender
   * duly set it on every record the AEAT had rejected. That is precisely the
   * case where it must NOT be set, and the mistake was self-preserving:
   *
   *   rejected -> "this is a subsanación" -> 3002 "No existe el registro de
   *   facturación" -> which is itself Incorrecto -> so the flag stays on
   *
   * Twenty-two records reached a state where no future attempt could ever
   * succeed, because each one told the AEAT to amend a record it had never
   * registered. A rejected record was never registered: it goes again as an
   * ordinary alta, carrying nothing.
   *
   * So this stays unset for a resend after rejection, and is for the case it
   * names: amending a record the AEAT accepted. Nothing sets it today --
   * accepted records leave the queue -- and it is kept because the 1161 rule
   * above cost a day to learn and the next person to need a subsanación
   * should not learn it again.
   */
  subsanacion?: boolean
  /**
   * Replace the destinatario with a fixed test identity.
   *
   * Set by the sender for every environment that is not production, because
   * the endpoint is the ONLY thing `environment` changes -- the document is
   * built identically for both, so real patients' names and NIFs were going
   * to the AEAT's preproduction service. Named for what it does rather than
   * for the environment, so the builder stays a pure function of its input
   * and the decision sits with the caller that knows where it is sending.
   *
   * Only the recipient. Everything else in the record feeds the huella, or
   * must match the certificate. See buildRegistroAlta.
   */
  anonymiseRecipient?: boolean
}

/**
 * The stand-in destinatario, identified the way the schema identifies someone
 * the AEAT cannot look up.
 *
 * The first attempt at this used a NIF -- 00000000T, chosen because 0 mod 23
 * is T, so it satisfies the checksum. The AEAT refused all sixteen of them:
 *
 *   1239  Error en el bloque Destinatario.. El formato del NIF es incorrecto..
 *         NIF:00000000T. NOMBRE_RAZON:Destinatario de pruebas.
 *
 * A valid checksum is not a valid NIF. The all-zero number is excluded
 * outright, and anything else that passes the format check then has to exist
 * in the census -- so there is no invented NIF that survives both, and
 * borrowing a real one would put a real person on the record.
 *
 * IDOtro with IDType 07 was the second attempt, on the reading that L7's "No
 * Censado" is the schema's own word for a recipient the AEAT cannot look up.
 * It refused that too, naming the value again:
 *
 *   1239  Error en el bloque Destinatario.. El campo ID no contiene un NIF
 *         con formato correcto.  ID:PRUEBAS
 *
 * So the ID under IDType 07 must ALSO be NIF-shaped, at least for CodigoPais
 * ES. Between the two attempts the position is: this block requires something
 * NIF-shaped whichever field carries it, an invented one fails format or the
 * census, and a real person's is the thing being avoided.
 *
 * Which leaves the one NIF that is real, passes both checks, and belongs to
 * nobody who needs protecting: the obligado's own. It is already in every
 * record as IDEmisorFactura, and a company's tax identifier is not personal
 * data. Taken from record.issuerNif rather than written down here, so it
 * stays correct for any clinic rather than only this one.
 *
 * The risk this carries, stated plainly because it is untested: a destinatario
 * equal to the emisor may read to the AEAT as self-invoicing and draw a rule
 * of its own. If it does, it says so per record -- #380 made that cheap -- and
 * the fallback is to accept that F1 and R1 cannot be exercised against
 * preproduction without a real recipient.
 */
export const TEST_DESTINATARIO_NAME = 'Destinatario de pruebas'

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
  // Against the AEAT's PREPRODUCTION service the destinatario is substituted,
  // because "test environment" and "test data" are not the same thing and only
  // the first of them was ever true here. environment picks the endpoint and
  // nothing else: the envelope is byte-identical either way, so 53 real
  // patients' names -- and, once the NIF began resolving, their NIFs -- went to
  // prewww1.aeat.es on invoices from a clinic, which says what they were
  // treated for.
  //
  // Nothing filed there has fiscal effect, which is the question usually asked
  // and the wrong one. There is no legal obligation covering a tax authority's
  // test system, so the lawful basis that carries a real filing does not
  // stretch to it, and a preproduction environment is not where a clinic's
  // patient list belongs. It matters more once other clinics are on this.
  //
  // What is NOT substituted is deliberate. Amounts, dates, serie and the
  // issuer's own NIF all feed factura_huella_input(), so changing them would
  // invalidate the chain the test is there to exercise -- and the issuer NIF
  // must match the certificate anyway. The recipient feeds nothing: the huella
  // is IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura, TipoFactura,
  // CuotaTotal, ImporteTotal, the previous Huella and the timestamp. So this
  // is the one field that can be replaced without weakening the test.
  //
  const recipientName = input.anonymiseRecipient
    ? TEST_DESTINATARIO_NAME
    : capped((factura.recipientName || factura.patientName || '').trim(), 120)
  // The stand-in identifies itself with the OBLIGADO's own NIF -- see
  // TEST_DESTINATARIO_NAME for why nothing else survives.
  const recipientNif = input.anonymiseRecipient
    ? record.issuerNif
    : (factura.recipientNif || factura.patientNif || '').trim()

  // NombreRazon then ONE of NIF or IDOtro -- PersonaFisicaJuridicaType is a
  // choice, so sending both is refused by the schema.
  const idDestinatario = [L('NIF', recipientNif)]

  // A destinatario needs a name AND an identifier. IDDestinatario carries
  // NombreRazon plus either NIF or IDOtro, and sending the name alone is
  // refused by the schema itself rather than by a per-record verdict:
  //
  //   SOAP Fault, HTTP 200
  //   Codigo[4102]. El XML no cumple el esquema.
  //   Falta informar campo obligatorio.: NIF
  //
  // A fault rejects the whole envelope, so one unidentifiable recipient
  // stops every other record in the batch. Hence the block goes in only when
  // both halves are present.
  //
  // The NIF resolves from the patient for the same reason the name does: the
  // factura freezes a recipient only once delivered, so before that both live
  // on the patient -- which is what loadFacturaDocumentData has always done
  // when rendering the document.
  //
  // What remains when a patient has no NIF on file is not a serialisation
  // problem. A factura completa must identify its recipient (RD 1619/2012
  // art. 6), so such a factura should not have been F1 -- and the sender
  // leaving Destinatarios out lets the AEAT say so per record, which is more
  // useful than a fault that blames the envelope.
  const destinatarios =
    record.invoiceType === 'F2' || !recipientName || (!recipientNif && !input.anonymiseRecipient)
      ? []
      : [
          '<sum1:Destinatarios>',
          '<sum1:IDDestinatario>',
          L('NombreRazon', recipientName),
          ...idDestinatario,
          '</sum1:IDDestinatario>',
          '</sum1:Destinatarios>',
        ]

  // A rectificativa must say HOW it corrects, and the AEAT rejects it outright
  // when it does not:
  //
  //   1114  Si la factura es de tipo rectificativa, el campo TipoRectificativa
  //         debe tener valor.
  //
  // "I" -- por diferencias -- because that is what issueRectificativa()
  // produces: a factura whose base, cuota and total are NEGATIVE, carrying the
  // amount going back rather than a restatement of the corrected invoice. "S"
  // is the other shape, where the record's totals are the corrected invoice's
  // new totals and ImporteRectificacion carries the ones it replaces. Sending
  // "S" for a negative document would tell the AEAT the corrected factura is
  // now worth minus what was refunded.
  //
  // ImporteRectificacion therefore has no place here: the schema describes it
  // as the "Base y Cuota sustituida en las Facturas Rectificativas
  // SUSTITUTIVAS", and there is nothing substituted.
  const rectificativa = record.invoiceType.startsWith('R')
    ? [
        L('TipoRectificativa', 'I'),
        // Which factura is being corrected. Named in full -- emisor, serie and
        // date -- because that is how the AEAT identifies an invoice, the same
        // triple as Encadenamiento. Omitted when the refund could not be traced
        // to a single factura, which issueRectificativa() allows: better a
        // rectificativa the AEAT holds without the back-reference than one it
        // refuses.
        ...(input.rectifies
          ? [
              '<sum1:FacturasRectificadas>',
              '<sum1:IDFacturaRectificada>',
              L('IDEmisorFactura', input.rectifies.issuerNif),
              L('NumSerieFactura', input.rectifies.serieNumber),
              L('FechaExpedicionFactura', aeatDate(input.rectifies.issuedOn)),
              '</sum1:IDFacturaRectificada>',
              '</sum1:FacturasRectificadas>',
            ]
          : []),
      ]
    : []

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
    // #330 sent the second flag without the first and every retry was refused.
    // The fix was to send both -- correct as far as it goes, and it made the
    // pair reachable from a plain resend, which is what #420 then did. Read
    // `subsanacion` above before setting this from anything: the two flags say
    // "amend the record you hold", and a record the AEAT REJECTED is not one
    // it holds.
    ...(input.subsanacion ? [L('Subsanacion', 'S'), L('RechazoPrevio', 'S')] : []),
    L('TipoFactura', record.invoiceType),
    // Order is not free: TipoRectificativa and FacturasRectificadas sit
    // between TipoFactura and DescripcionOperacion in the XSD sequence, and
    // an element out of order fails the schema rather than a validation.
    ...rectificativa,
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
