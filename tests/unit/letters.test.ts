import { describe, it, expect } from 'vitest'
import { fillLetterBody, letterFileName, letterTokens, parseLetterHtml, sanitizeLetterHtml } from '../../utils/letters'
import { fillMergeTokens, renderTemplateFields } from '../../utils/docFields'

// A letter body is whatever a contenteditable produced, stored by any member
// through the Data API. It is reduced to paragraphs, breaks, b/i/u and lists
// before it is shown again or drawn into the PDF.

describe('letter bodies', () => {
  it('keeps paragraphs, formatting and lists', () => {
    const html = '<p>Hola <b>Ana</b>,</p><ul><li>uno</li><li><i>dos</i></li></ul><ol><li>a</li><li>b</li></ol><p>Fin<br>firma</p>'
    expect(sanitizeLetterHtml(html)).toBe(html)
    const blocks = parseLetterHtml(html)
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'li', 'li', 'li', 'li', 'p'])
    expect(blocks[4]).toMatchObject({ kind: 'li', ordered: true, index: 2 })
    expect(blocks[0]!.runs).toEqual([{ text: 'Hola ' }, { text: 'Ana', bold: true }, { text: ',' }])
  })

  it('drops scripts, attributes and unknown tags', () => {
    const html = '<div onclick="x()">Hola<script>alert(1)</script> <img src=x onerror="alert(2)"><a href="javascript:y">enlace</a></div><style>p{}</style>'
    expect(sanitizeLetterHtml(html)).toBe('<p>Hola enlace</p>')
  })

  it('treats the divs and brs a contenteditable writes as paragraphs and blank lines', () => {
    expect(sanitizeLetterHtml('Primera<div>Segunda<br></div><div><br></div><div>Cuarta</div>')).toBe('<p>Primera</p><p>Segunda</p><p><br></p><p>Cuarta</p>')
  })

  it('escapes what it decodes, so text never becomes markup', () => {
    expect(sanitizeLetterHtml('<p>&lt;script&gt; &amp; 3 &lt; 4</p>')).toBe('<p>&lt;script&gt; &amp; 3 &lt; 4</p>')
    expect(sanitizeLetterHtml('a < b')).toBe('<p>a &lt; b</p>')
  })

  it('fills merge fields with escaped values', () => {
    const body = fillLetterBody('<p>Paciente: <b>{{full_name}}</b>, DNI {{national_id}}. {{unknown}}Fin</p>', { full_name: 'Ana <b>López</b>', national_id: '12345678Z' })
    expect(body).toBe('<p>Paciente: <b>Ana &lt;b&gt;López&lt;/b&gt;</b>, DNI 12345678Z. Fin</p>')
  })

  it('lists the merge fields a body uses', () => {
    expect(letterTokens('<p>{{full_name}} {{diagnosis}} {{full_name}}</p>')).toEqual(['full_name', 'diagnosis'])
  })

  it('names the file after the letter', () => {
    expect(letterFileName('Informe para su médico', '2026-10-22T10:00:00Z')).toBe('informe-para-su-medico-2026-10-22.pdf')
    expect(letterFileName('¿?', '2026-10-22')).toBe('carta-2026-10-22.pdf')
  })
})

describe('merge tokens', () => {
  it('are the same for forms and letters', () => {
    expect(fillMergeTokens('Hola {{first_name}} {{nope}}', { first_name: 'Ana' })).toBe('Hola Ana ')
    const [field] = renderTemplateFields([{ id: '1', type: 'text', label: 'Hola {{first_name}}' }], { first_name: 'Ana' })
    expect(field!.label).toBe('Hola Ana')
  })
})
