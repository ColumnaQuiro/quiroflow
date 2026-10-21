import { describe, expect, it } from 'vitest'
import { editableFileName, renamedFileName } from '../../utils/renameFile'

// Renaming a patient's file (utils/renameFile.ts).
describe('renamedFileName', () => {
  it('keeps the extension when the new name has none', () => {
    expect(renamedFileName('Informe RX', 'scan_0042.pdf')).toBe('Informe RX.pdf')
    expect(renamedFileName('Postura enero', 'IMG_1234.JPG')).toBe('Postura enero.JPG')
  })
  it('takes the new name’s own extension', () => {
    expect(renamedFileName('informe.docx', 'scan.pdf')).toBe('informe.docx')
  })
  it('is null for a blank name or no change', () => {
    expect(renamedFileName('   ', 'scan.pdf')).toBeNull()
    expect(renamedFileName('scan', 'scan.pdf')).toBeNull()
  })
  it('tidies spaces and slashes', () => {
    expect(renamedFileName('  RX  a/b  ', 'x.png')).toBe('RX a b.png')
  })
  it('starts the field without the extension', () => {
    expect(editableFileName('scan_0042.pdf')).toBe('scan_0042')
    expect(editableFileName('sin extension')).toBe('sin extension')
  })
})
