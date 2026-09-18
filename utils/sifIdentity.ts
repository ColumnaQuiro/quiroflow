// Who this invoicing system says it is.
//
// RD 1007/2023 makes the SIF's producer declare the system by name, code and
// version, and that declaration has to name the version actually running --
// a declaración responsable pointing at a version nobody is using describes
// nothing. One place, so the page a clinic reads and anything that later
// transmits to the AEAT cannot disagree about which system is speaking.
//
// VERSION is bumped with the release that changes how facturación behaves.
// It is deliberately NOT the marketing version of the whole app: a change to
// the calendar does not make this a different invoicing system, and
// reissuing the declaration for it would make the version meaningless.
export const SIF_NAME = 'QuiroFlow'
export const SIF_CODE = 'QF-SIF'
export const SIF_VERSION = '1.24.0'

// The formula the huella chain is built with, mirrored from the database's
// factura_huella_spec_version(). Named here too because the declaration
// describes the system, and this is the part of it that a tax inspector
// would actually recompute.
export const SIF_HUELLA_SPEC = 'aeat-0.1.2'

/**
 * The producer -- the party that bears the declaración responsable.
 *
 * Not the clinic. A clinic using QuiroFlow is the obligado tributario; the
 * producer is whoever develops the software, and that obligation exists even
 * for software built only for its own use. Once it is sold to other clinics
 * it cannot be disclaimed.
 *
 * NIF and domicilio are deliberately left blank rather than guessed: they go
 * on a document with legal effect, and the entity that sells QuiroFlow has
 * not been confirmed to be the same one that operates the clinic.
 */
export const SIF_PRODUCER = {
  name: 'QuiroFlow',
  nif: '',
  address: '',
} as const

/** Whether the declaration can honestly be made yet. See the page. */
export const SIF_DECLARATION_IN_FORCE = false
