// Talking to the AEAT: the envelope out, and the answer back.
//
// Still no transport here -- no HTTP, no certificate, no mTLS agent. This is
// the request document and the response parser, which are the parts that can
// be got right and tested before any of that exists. The sender that uses
// them is small by comparison and mostly about credentials.
//
import { SIF_PRODUCER } from './sifIdentity'

// Endpoints, namespaces, limits and the response shape all come from AEAT's
// own WSDL (SistemaFacturacion.wsdl), RespuestaSuministro.xsd, and
// Descripción SWeb 1.0.3.

/**
 * Where the records go.
 *
 * Four endpoints, and the distinction between them is not cosmetic. The WSDL
 * names its ports SistemaVerifactu and SistemaVerifactuSello (plus Pruebas
 * variants): the plain one expects a certificate identifying a person, the
 * Sello one expects a certificado de SELLO -- an entity's seal, meant for
 * unattended automated use.
 *
 * QuiroFlow transmits for many clinics from a server with nobody sitting at
 * it, under its own qualified certificate and their apoderamiento. That is
 * the seal case, so the Sello endpoints are the ones this will use. Getting
 * this wrong means buying the wrong certificate, which is weeks, not hours.
 */
export const VERIFACTU_ENDPOINTS = {
  production: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  productionSello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  test: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  testSello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
} as const

/** The one this system will use, once it has a seal certificate. */
export function verifactuEndpoint(env: 'test' | 'production'): string {
  return env === 'production' ? VERIFACTU_ENDPOINTS.productionSello : VERIFACTU_ENDPOINTS.testSello
}

const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'
const NS_SUM = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd'
const NS_SUM1 = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'

/**
 * At most 1000 records per envío (Descripción SWeb, §estructura de envíos).
 * Sending 1001 is rejected wholesale, so batching has to know the ceiling.
 */
export const MAX_RECORDS_PER_SUBMISSION = 1000

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The SOAP request carrying one or more RegistroAlta elements.
 *
 * Cabecera names the OBLIGADO -- the clinic whose facturación this is -- not
 * us. We are the sender, identified by the certificate on the connection;
 * the obligado is whose records these are. Conflating the two is the mistake
 * that a third-party sender is most likely to make, and it would file every
 * clinic's invoices under QuiroFlow's NIF.
 *
 * One envelope per obligado for the same reason: Cabecera is singular, so a
 * batch cannot span clinics however convenient that would be.
 */
export function buildRegFactuEnvelope(input: {
  obligado: { nif: string; nombreRazon: string }
  /** Already-built RegistroAlta elements, in chain order. */
  registros: string[]
}): string {
  if (input.registros.length === 0) {
    throw new Error('buildRegFactuEnvelope: nothing to send')
  }
  if (input.registros.length > MAX_RECORDS_PER_SUBMISSION) {
    // Better here than as a wholesale rejection of a thousand good records.
    throw new Error(
      `buildRegFactuEnvelope: ${input.registros.length} records exceeds the AEAT limit of ${MAX_RECORDS_PER_SUBMISSION}`,
    )
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:sum="${NS_SUM}" xmlns:sum1="${NS_SUM1}">`,
    '<soapenv:Body>',
    '<sum:RegFactuSistemaFacturacion>',
    '<sum:Cabecera>',
    '<sum1:ObligadoEmision>',
    `<sum1:NombreRazon>${esc(input.obligado.nombreRazon)}</sum1:NombreRazon>`,
    `<sum1:NIF>${esc(input.obligado.nif)}</sum1:NIF>`,
    '</sum1:ObligadoEmision>',
    '</sum:Cabecera>',
    ...input.registros.map((r) => `<sum:RegistroFactura>${r}</sum:RegistroFactura>`),
    '</sum:RegFactuSistemaFacturacion>',
    '</soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('')
}

export interface SenderConfig {
  environment: 'test' | 'production'
  /** PKCS#12 seal certificate. Absent until one is obtained. */
  certificatePath?: string
  certificatePassphrase?: string
}

export type BlockedReason =
  | 'no-producer-nif'
  | 'no-certificate'
  | 'nothing-to-send'
  | 'waiting-on-aeat-pace'

/**
 * Why this account cannot transmit right now, or null if it can.
 *
 * Returned rather than thrown, and checked before anything is built: a
 * partially assembled submission that then cannot go is harder to reason
 * about than one that was never started.
 */
export function transmissionBlockedBy(input: {
  config: SenderConfig
  pendingCount: number
  readyAt: Date
  now?: Date
  /**
   * Defaults to the configured producer, which is how callers use it. Taken
   * as an input so the pacing rules below can be tested on their own instead
   * of being permanently short-circuited by the blank NIF -- a rule that
   * cannot be exercised until the day it matters is a rule nobody has checked.
   */
  producerNif?: string
}): BlockedReason | null {
  // The producer's NIF rides on every record. Sending without it would put a
  // malformed SistemaInformatico block on real fiscal records.
  const producerNif = input.producerNif ?? SIF_PRODUCER.nif
  if (!producerNif) return 'no-producer-nif'
  if (!input.config.certificatePath) return 'no-certificate'
  if (input.pendingCount === 0) return 'nothing-to-send'

  // The AEAT's pace, with the escape the spec allows: a full batch may go
  // immediately, "la circunstancia que ocurra primero". Without that, 1000
  // ready records would sit waiting for a timer for no reason.
  const now = input.now ?? new Date()
  if (input.pendingCount < MAX_RECORDS_PER_SUBMISSION && now < input.readyAt) return 'waiting-on-aeat-pace'

  return null
}

/** AEAT's per-record verdicts, unchanged -- the same strings #326 stores. */
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'
/** AEAT's verdict on the submission as a whole. */
export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'

export interface VerifactuLine {
  serieNumber: string | null
  estado: EstadoRegistro | null
  errorCode: string | null
  errorMessage: string | null
  duplicated: boolean
}

export interface VerifactuResponse {
  estadoEnvio: EstadoEnvio | null
  csv: string | null
  /**
   * Seconds to wait before the next submission. AEAT dictates the pace:
   * "el sistema informático deberá esperar a que transcurran
   * <TiempoEsperaEnvio> segundos desde el anterior envío". Ignoring it is how
   * a sender gets throttled or refused, so it is parsed as a first-class
   * result rather than left in the XML.
   */
  waitSeconds: number | null
  lines: VerifactuLine[]
}

/**
 * Reads a value by LOCAL element name, ignoring namespace prefixes.
 *
 * AEAT's own documents use sf/sfR and the live service may prefix
 * differently; matching on the prefix would work until the day it did not,
 * and the failure would look like "the AEAT accepted nothing" rather than
 * like a parsing bug.
 */
function localTag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${name}>`).exec(xml)
  return m ? m[1].trim() : null
}

function localBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${name}>`, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/**
 * Turns the AEAT's answer into the per-record verdicts the submissions table
 * stores.
 *
 * Deliberately does NOT decide what to do about them. "AceptadoConErrores is
 * registered, Incorrecto is not" is a rule about resending, and it lives with
 * the sender and the schema, not in a parser -- a parser that also decided
 * policy would make the rule true in two places.
 */
export function parseVerifactuResponse(xml: string): VerifactuResponse {
  const estadoEnvio = localTag(xml, 'EstadoEnvio') as EstadoEnvio | null
  const csv = localTag(xml, 'CSV')
  const waitRaw = localTag(xml, 'TiempoEsperaEnvio')
  const waitSeconds = waitRaw !== null && waitRaw !== '' && !Number.isNaN(Number(waitRaw)) ? Number(waitRaw) : null

  const lines = localBlocks(xml, 'RespuestaLinea').map((block) => {
    const dup = localTag(block, 'RegistroDuplicado')
    const msg = localTag(block, 'DescripcionErrorRegistro')
    return {
      // NumSerieFactura lives inside IDFactura; reading it from the line as a
      // whole is the same value and survives the block being reshaped.
      serieNumber: localTag(block, 'NumSerieFactura'),
      estado: localTag(block, 'EstadoRegistro') as EstadoRegistro | null,
      errorCode: localTag(block, 'CodigoErrorRegistro'),
      errorMessage: msg === null ? null : unescape(msg),
      duplicated: dup !== null,
    }
  })

  return { estadoEnvio, csv, waitSeconds, lines }
}
