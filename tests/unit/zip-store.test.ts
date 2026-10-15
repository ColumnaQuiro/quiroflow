import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createZip, toCsv } from '../../server/utils/zipStore'

// The patient data export's ZIP (server/utils/zipStore.ts), read back by an
// independent implementation: if Python's zipfile lists it, passes every CRC
// and extracts it byte for byte, so does what a patient opens it with.
describe('createZip', () => {
  it('writes an archive unzip reads back exactly, accents in names included', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) % 256)
    const zip = createZip([
      { name: 'LEEME.txt', data: 'Copia de los datos' },
      { name: '07_archivos/Informe de revisión.pdf', data: bytes },
    ])
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    const file = join(dir, 'a.zip')
    writeFileSync(file, zip)
    // Python's zipfile reads the UTF-8 name flag (macOS's bundled unzip
    // does not), and checks every entry's CRC in testzip().
    const read = (code: string) => execFileSync('python3', ['-c', `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\n${code}`, file])
    expect(read('assert z.testzip() is None\nprint("\\n".join(z.namelist()))').toString('utf8').trim().split('\n')).toEqual(['LEEME.txt', '07_archivos/Informe de revisión.pdf'])
    expect(read('sys.stdout.buffer.write(z.read("LEEME.txt"))').toString('utf8')).toBe('Copia de los datos')
    expect(new Uint8Array(read('sys.stdout.buffer.write(z.read("07_archivos/Informe de revisión.pdf"))'))).toEqual(bytes)
  })
})

describe('toCsv', () => {
  it('quotes what needs it, with semicolons and a BOM for Excel', () => {
    expect(toCsv([{ a: 'x;y', b: 'dijo "hola"', c: null }, { a: 1, d: { k: 2 } }])).toBe('﻿a;b;c;d\r\n"x;y";"dijo ""hola""";;\r\n1;;;"{""k"":2}"')
  })
})
