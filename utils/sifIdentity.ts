// Who this invoicing system says it is.
//
// RD 1007/2023 makes the SIF's producer declare the system by name, code and
// version, and that declaration has to name the version actually running --
// a declaración responsable pointing at a version nobody is using describes
// nothing. One place, so the page a clinic reads and the SistemaInformatico
// block on every transmitted record cannot disagree about which system is
// speaking.
//
// The field names and their limits come from AEAT's own record design
// (DsRegistroVeriFactu.xlsx, sheet «5)Definición SistemaInformatico»), not
// from a vendor summary. Several of them are narrower than they look.
export const SIF_NAME = 'QuiroFlow'

/**
 * NombreSistemaInformatico -- Alfanumérico (30).
 *
 * The producer's name for the system. Obligatorio on alta and anulación
 * records.
 */
export const SIF_SYSTEM_NAME = 'QuiroFlow'

/**
 * IdSistemaInformatico -- Alfanumérico (2). TWO characters.
 *
 * Not a slug and not room for one. Its job is to distinguish this SIF from
 * other SIFs by the SAME producer, so two characters is enough for what it
 * is actually for.
 *
 * This was 'QF-SIF' when the declaración responsable page first shipped,
 * which is six -- long enough to be rejected on every record once
 * transmission starts, and meanwhile published on a page whose whole purpose
 * is to identify the system correctly.
 */
export const SIF_CODE = 'QF'

/**
 * Version -- Alfanumérico (50).
 *
 * Bumped with the release that changes how facturación behaves. Deliberately
 * NOT the marketing version of the whole app: a change to the calendar does
 * not make this a different invoicing system, and reissuing the declaration
 * for it would make the version meaningless.
 */
export const SIF_VERSION = '1.24.0'

// The formula the huella chain is built with, mirrored from the database's
// factura_huella_spec_version(). Named here too because the declaration
// describes the system, and this is the part of it that a tax inspector
// would actually recompute.
export const SIF_HUELLA_SPEC = 'aeat-0.1.2'

/**
 * TipoUsoPosibleSoloVerifactu -- "S" or "N".
 *
 * "S" means the system can ONLY comply by operating as VERI*FACTU. That is
 * what we are building: transmitting removes the obligation to sign every
 * factura record and every event record, and removes the registro de eventos
 * entirely -- none of which exists here, because the other modality was never
 * the plan.
 *
 * So this is a commitment, not a description. Declaring "S" and later adding
 * a non-transmitting mode would make every record already sent wrong about
 * the system that produced it.
 */
export const SIF_ONLY_VERIFACTU = 'S'

/**
 * TipoUsoPosibleMultiOT -- "S" or "N".
 *
 * Whether the system can keep the facturación of several obligados
 * tributarios independently. QuiroFlow is multi-tenant by construction: one
 * deployment, one database, a separate factura series and huella chain per
 * account.
 */
export const SIF_SUPPORTS_MULTIPLE_OBLIGADOS = 'S'

/**
 * The producer -- the party that bears the declaración responsable, and whose
 * NombreRazon and NIF go in the SistemaInformatico block of EVERY record.
 *
 * Not the clinic. A clinic using QuiroFlow is the obligado tributario; the
 * producer is whoever develops the software, and that obligation exists even
 * for software built only for its own use. Once it is sold to other clinics
 * it cannot be disclaimed.
 *
 * Confirmed 19 Sep 2026: QuiroFlow is produced and sold by the same company
 * that operates the clinic. So the producer and the first obligado share a
 * NIF, which is legitimate and worth stating plainly rather than leaving to
 * be inferred -- they are still two different roles, and the SistemaInformatico
 * block (producer) and Cabecera/ObligadoEmision (obligado) stay separate
 * fields that happen to agree today. The moment a second clinic transmits,
 * only one of them changes.
 *
 * NombreRazon is Alfanumérico (120), NIF is FormatoNIF (9).
 */
export const SIF_PRODUCER = {
  name: 'Columnaquiro S.L',
  nif: 'B16365504',
  address: 'Calle Vivons 29, Bajo Izquierdo, 46006 Valencia',
} as const

/** Whether the declaration can honestly be made yet. See the page. */
export const SIF_DECLARATION_IN_FORCE = false

/**
 * The producer is fully identified -- every field the SistemaInformatico block
 * needs from us is known.
 *
 * Deliberately NOT called "can transmit". It says nothing about the
 * certificate, and a flag that conflated the two would let the page announce
 * that remisión can begin while the sender still refuses for want of a
 * certificate. transmissionBlockedBy() is what actually decides, and it
 * checks both.
 */
export const SIF_PRODUCER_IDENTIFIED = SIF_PRODUCER.nif.length > 0

/**
 * NumeroInstalacion -- Alfanumérico (100).
 *
 * Must distinguish this installation from every other SIF installation used
 * for the same obligado's facturación, "pasadas, presentes o futuras", even
 * where those installations run the same producer's SIF.
 *
 * For a hosted multi-tenant system the natural unit is the account: each
 * clinic's facturación is kept by one installation, and the account id is
 * stable, unique, and already the thing the series and the huella chain hang
 * off. A single constant would be wrong -- it would claim every clinic is the
 * same installation.
 */
export function sifInstallationNumber(accountId: string): string {
  return `qf-${accountId}`
}

/**
 * Every field of the SistemaInformatico block except IndicadorMultiplesOT,
 * which cannot be decided here -- see the database function of that name.
 */
export function sifSystemBlock(accountId: string) {
  return {
    NombreRazon: SIF_PRODUCER.name,
    NIF: SIF_PRODUCER.nif,
    NombreSistemaInformatico: SIF_SYSTEM_NAME,
    IdSistemaInformatico: SIF_CODE,
    Version: SIF_VERSION,
    NumeroInstalacion: sifInstallationNumber(accountId),
    TipoUsoPosibleSoloVerifactu: SIF_ONLY_VERIFACTU,
    TipoUsoPosibleMultiOT: SIF_SUPPORTS_MULTIPLE_OBLIGADOS,
  }
}

/**
 * The lengths AEAT enforces, kept beside the values so a change that breaks
 * one is caught here rather than by a rejected record.
 */
export const SIF_FIELD_LIMITS = {
  NombreRazon: 120,
  NIF: 9,
  NombreSistemaInformatico: 30,
  IdSistemaInformatico: 2,
  Version: 50,
  NumeroInstalacion: 100,
} as const
