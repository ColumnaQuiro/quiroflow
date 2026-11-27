// Reading a clinic's own patient export (Patients > Import, "Other system"):
// the parts of it that need no page, so they can be pinned by unit tests.

/**
 * A line with nothing on it but separators, quotes and spaces. Quirocitas'
 * patient list export opens with one (",,,,,,,,,,,,,") above the real header,
 * and read as the header it turned every column into "" / "_1" / "_2"...
 */
const BLANK_LINE = /^[\s,;\t"']*$/

/** The text from its first non-blank line on, and how many lines were dropped before it. */
export function skipBlankLeadingLines(text: string): { text: string; skipped: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let skipped = 0
  while (skipped < lines.length - 1 && BLANK_LINE.test(lines[skipped])) skipped++
  return { text: lines.slice(skipped).join('\n'), skipped }
}

/** Index of the first spreadsheet row with any cell filled in (0 when there is none). */
export function firstFilledRow(rows: unknown[][]): number {
  const index = rows.findIndex((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''))
  return index < 0 ? 0 : index
}

// -- Dates of birth ------------------------------------------------------------
// Exports write dates the way their country does, and the database reads a
// bare "23-02-1989" month first: that one is refused outright ("date/time
// field value out of range"), failing its whole chunk of 100 rows, and
// "06-08-1970" is quietly stored as 8 June. So every date is turned into
// YYYY-MM-DD here, before it is sent.

/** Day first (Spain, most of Europe) or month first (US exports). */
export type ImportDateOrder = 'dmy' | 'mdy'

const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/
const DAY_MONTH_YEAR = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/

/**
 * Which way round a file writes its dates, from all of them at once: a first
 * number over 12 can only be a day, and a second one over 12 means month
 * first. When nothing settles it (every day and month 12 or under), day first.
 */
export function importDateOrder(values: string[]): ImportDateOrder {
  let monthFirst = false
  for (const value of values) {
    const m = value.trim().match(DAY_MONTH_YEAR)
    if (!m) continue
    if (Number(m[1]) > 12) return 'dmy'
    if (Number(m[2]) > 12) monthFirst = true
  }
  return monthFirst ? 'mdy' : 'dmy'
}

function isoIfReal(year: number, month: number, day: number): string | null {
  if (year < 1 || month < 1 || month > 12 || day < 1) return null
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

/**
 * A date as the file wrote it, as YYYY-MM-DD; null when it is blank or not a
 * real date. A two-digit year is a birth year, so in the past: with today in
 * 2026, "89" is 1989 and "05" is 2005.
 */
export function importDate(value: string, order: ImportDateOrder, today: Date = new Date()): string | null {
  const text = value.trim()
  if (!text) return null
  const iso = text.match(ISO)
  if (iso) return isoIfReal(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const m = text.match(DAY_MONTH_YEAR)
  if (!m) return null
  const [first, second] = [Number(m[1]), Number(m[2])]
  let year = Number(m[3])
  if (m[3].length === 2) {
    year += 2000
    if (year > today.getUTCFullYear()) year -= 100
  }
  return order === 'dmy' ? isoIfReal(year, second, first) : isoIfReal(year, first, second)
}

// -- Why a row could not be saved, in words a clinic can act on ---------------
// The database's own message ("date/time field value out of range", "violates
// row-level security policy") means nothing at a front desk. Each known cause
// is said plainly with what to do about it; the original stays alongside it
// for whoever is asked to help.

export interface ImportErrorReason { en: string; es: string }

export function importErrorReason(message: string): ImportErrorReason {
  const m = message.toLowerCase()
  if (/date\/time field value out of range|invalid input syntax for type date/.test(m)) {
    return {
      en: 'a date is not valid. Write it as day-month-year (23-02-1989) or leave it empty in the file.',
      es: 'una fecha no es válida. Escríbela como día-mes-año (23-02-1989) o déjala vacía en el archivo.',
    }
  }
  const tooLong = m.match(/value too long for type character varying\((\d+)\)/)
  if (tooLong) {
    return {
      en: `a value is too long (at most ${tooLong[1]} characters). Shorten it in the file.`,
      es: `un dato es demasiado largo (máximo ${tooLong[1]} caracteres). Acórtalo en el archivo.`,
    }
  }
  if (/duplicate key|already exists/.test(m)) {
    return {
      en: 'another patient already has the same email, ID or record ID. Correct the repeated value in the file, or remove the row.',
      es: 'otro paciente ya tiene el mismo correo, DNI o ID de registro. Corrige el dato repetido en el archivo o quita la fila.',
    }
  }
  if (/row-level security|permission denied/.test(m)) {
    return {
      en: 'your user is not allowed to create or change patients. Ask the clinic owner for that permission.',
      es: 'tu usuario no tiene permiso para crear o cambiar pacientes. Pídele ese permiso al propietario de la clínica.',
    }
  }
  if (/failed to fetch|networkerror|network request failed|load failed|timeout/.test(m)) {
    return {
      en: 'the connection was lost. Check the internet connection and import the file again.',
      es: 'se perdió la conexión. Comprueba internet y vuelve a importar el archivo.',
    }
  }
  return {
    en: 'check this row in the file and correct it, then import the file again.',
    es: 'revisa esta fila en el archivo, corrígela y vuelve a importarlo.',
  }
}

/** Column names that are not names at all: what a blank header row turns into. */
export function headersMissing(fields: string[]): boolean {
  return fields.length > 0 && fields.every((f) => !f.trim() || /^_\d+$/.test(f.trim()) || /^(column|columna) \d+$/i.test(f.trim()))
}
