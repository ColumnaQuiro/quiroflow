import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import {
  firstFilledRow,
  headersMissing,
  importDate,
  importDateOrder,
  importErrorReason,
  skipBlankLeadingLines,
} from '../../utils/patientImportFile'

// Reading a clinic's own patient export (Patients > Import, "Other system").
// The case that prompted this: Quirocitas' patient list export opens with a
// line of bare commas above its header, and writes birth dates day first.

const QUIROCITAS = [
  ',,,,,,',
  'ID,Paciente,NIF,Nacimiento,Teléfono,email,Permiso',
  '2509,Nombre Inventado,,23-02-1989,600000001,uno@example.com,Si',
  '2549,Otra Persona,,06-08-1970,600000002,,Si',
].join('\n')

describe('blank lines above the header', () => {
  it('skips them, so the real header names the columns', () => {
    const { text, skipped } = skipBlankLeadingLines(QUIROCITAS)
    expect(skipped).toBe(1)
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
    expect(parsed.meta.fields).toEqual(['ID', 'Paciente', 'NIF', 'Nacimiento', 'Teléfono', 'email', 'Permiso'])
    expect(parsed.data).toHaveLength(2)
    expect(parsed.data[0].Paciente).toBe('Nombre Inventado')
  })

  it('treats semicolons, tabs, quotes, a BOM and CRLF as blank too', () => {
    const { text, skipped } = skipBlankLeadingLines('\uFEFF;;;\r\n\t""\r\n\r\nNombre;Email\r\nAna;a@example.com')
    expect(skipped).toBe(3)
    expect(text.startsWith('Nombre;Email')).toBe(true)
  })

  it('leaves a file that starts with its header alone', () => {
    expect(skipBlankLeadingLines('Nombre,Email\nAna,a@example.com')).toEqual({ text: 'Nombre,Email\nAna,a@example.com', skipped: 0 })
  })

  it('finds the first filled row of a spreadsheet', () => {
    expect(firstFilledRow([[null, ''], [undefined, '  '], ['Nombre', 'Email'], ['Ana', 'a@example.com']])).toBe(2)
    expect(firstFilledRow([['Nombre']])).toBe(0)
    expect(firstFilledRow([])).toBe(0)
  })

  it('knows a header row with no titles in it', () => {
    // What Papa makes of ",,,," read as the header.
    expect(headersMissing(['', '_1', '_2'])).toBe(true)
    expect(headersMissing(['Columna 1', 'Columna 2'])).toBe(true)
    expect(headersMissing(['Nombre', '_1'])).toBe(false)
    expect(headersMissing([])).toBe(false)
  })
})

describe('dates of birth', () => {
  it('reads day-first dates, which the database would read month first', () => {
    // "23-02-1989" is refused by Postgres (ISO, MDY); "06-08-1970" becomes 8 June.
    const order = importDateOrder(['23-02-1989', '06-08-1970', ''])
    expect(order).toBe('dmy')
    expect(importDate('23-02-1989', order)).toBe('1989-02-23')
    expect(importDate('06-08-1970', order)).toBe('1970-08-06')
  })

  it('takes day first when nothing in the file says otherwise', () => {
    expect(importDateOrder(['06-08-1970', '01/02/2000'])).toBe('dmy')
  })

  it('takes month first only when the file shows it', () => {
    const order = importDateOrder(['08/06/1970', '02/23/1989'])
    expect(order).toBe('mdy')
    expect(importDate('08/06/1970', order)).toBe('1970-08-06')
    expect(importDate('02/23/1989', order)).toBe('1989-02-23')
  })

  it('accepts slashes, dots, single digits, a time after it, and ISO dates', () => {
    expect(importDate('3/2/1989', 'dmy')).toBe('1989-02-03')
    expect(importDate('03.02.1989', 'dmy')).toBe('1989-02-03')
    expect(importDate('03-02-1989 00:00:00', 'dmy')).toBe('1989-02-03')
    expect(importDate('1989-02-03', 'dmy')).toBe('1989-02-03')
    expect(importDate('1989-02-03T00:00:00Z', 'mdy')).toBe('1989-02-03')
  })

  it('puts a two-digit year in the past', () => {
    const today = new Date('2026-11-27T12:00:00Z')
    expect(importDate('23/02/89', 'dmy', today)).toBe('1989-02-23')
    expect(importDate('23/02/05', 'dmy', today)).toBe('2005-02-23')
    expect(importDate('23/02/26', 'dmy', today)).toBe('2026-02-23')
    expect(importDate('23/02/27', 'dmy', today)).toBe('1927-02-23')
  })

  it('returns null for blanks and for anything that is not a real date', () => {
    expect(importDate('', 'dmy')).toBeNull()
    expect(importDate('  ', 'dmy')).toBeNull()
    expect(importDate('31-02-1989', 'dmy')).toBeNull()
    expect(importDate('00-00-0000', 'dmy')).toBeNull()
    expect(importDate('ayer', 'dmy')).toBeNull()
    expect(importDate('1989', 'dmy')).toBeNull()
  })
})

describe('why a row was not saved', () => {
  it('says what to do about a bad date', () => {
    expect(importErrorReason('date/time field value out of range: "23-02-1989"').es).toContain('día-mes-año')
  })

  it('names the limit on a value that is too long', () => {
    expect(importErrorReason('value too long for type character varying(20)').es).toContain('máximo 20 caracteres')
  })

  it('points at the repeated value on a clash', () => {
    expect(importErrorReason('duplicate key value violates unique constraint "patients_external_reference_uniq"').es).toContain('dato repetido')
  })

  it('sends a permission problem to the owner', () => {
    expect(importErrorReason('new row violates row-level security policy for table "patients"').es).toContain('propietario')
  })

  it('tells a lost connection apart', () => {
    expect(importErrorReason('TypeError: Failed to fetch').es).toContain('internet')
  })

  it('still says what to do about anything else', () => {
    expect(importErrorReason('something nobody has seen').es).toContain('revisa esta fila')
  })
})
