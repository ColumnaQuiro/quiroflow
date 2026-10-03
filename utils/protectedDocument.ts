// Sending a patient one of their files as a password-protected PDF, the
// password being their DNI/NIE when the clinic has it.
//
// A report or a scan is health data. A WhatsApp chat or an email inbox is a
// place it can be forwarded from, backed up to, or read over a shoulder in, so
// it travels encrypted and the key is something the patient already has. The
// password itself never travels with it: the message only says WHICH
// password it is.

/** Shortest password the clinic can choose by hand. A DNI is nine characters. */
export const MIN_DOCUMENT_PASSWORD_LENGTH = 6

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

/**
 * A Spanish DNI (12345678Z) or NIE (X1234567L), check letter included.
 * Checked properly rather than by shape: a DNI with the wrong letter is a
 * typo, and a typo here is a document the patient cannot open.
 */
export function isSpanishId(value: string): boolean {
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(value)
  if (!m) return false
  const [, niePrefix, digits, letter] = m
  if (niePrefix ? digits!.length !== 7 : digits!.length !== 8) return false
  const number = Number(`${niePrefix ? 'XYZ'.indexOf(niePrefix) : ''}${digits}`)
  return DNI_LETTERS[number % 23] === letter
}

/**
 * The password a document is encrypted with.
 *
 * A DNI/NIE is brought to one spelling -- capitals, no spaces, dots or
 * hyphens -- because the patient will type it from memory and the PDF
 * password is exact: "12345678z" does not open a file locked with
 * "12345678Z". The message tells them to use the capital letter. Anything
 * else is kept exactly as the clinic typed it (trimmed), because the clinic
 * will tell the patient that exact password.
 */
export function documentPassword(raw: string): string {
  const trimmed = raw.trim()
  const asId = trimmed.toUpperCase().replace(/[\s.-]/g, '')
  return isSpanishId(asId) ? asId : trimmed
}

/** "Informe Emmanuel.pdf" -> "Informe Emmanuel (protegido).pdf". */
export function protectedFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || 'Documento'
  return `${base} (protegido).pdf`
}

/**
 * What the patient reads beside the document. Names which password it is,
 * never the password.
 */
export function defaultProtectedCaption(opts: { fileName: string; passwordIsNationalId: boolean; english?: boolean }): string {
  const name = opts.fileName.replace(/\.[^.]+$/, '').trim()
  if (opts.english) {
    return opts.passwordIsNationalId
      ? `Here is your document "${name}". It is password-protected: the password is your DNI/NIE, with the letter in capitals and no spaces.`
      : `Here is your document "${name}". It is password-protected with the password we gave you at the clinic.`
  }
  return opts.passwordIsNationalId
    ? `Te enviamos tu documento «${name}». Está protegido con contraseña: es tu DNI/NIE, con la letra en mayúscula y sin espacios.`
    : `Te enviamos tu documento «${name}». Está protegido con la contraseña que te hemos indicado en la clínica.`
}

/**
 * Whether a message would hand over the key along with the lock. Compared
 * without case, spaces or separators, so "12345678-z" in the text still
 * counts as the DNI it is.
 */
export function captionRevealsPassword(caption: string, password: string): boolean {
  const squash = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '')
  const key = squash(password)
  return key.length > 0 && squash(caption).includes(key)
}
