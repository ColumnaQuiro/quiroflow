import { describe, expect, it } from 'vitest'
import { insertWhatsAppText, parseWhatsAppText, toggleWhatsAppLines, toggleWhatsAppStyle, type WhatsAppEdit } from '../../utils/whatsappFormatting'

// "[" and "]" mark the selection, so a case reads the way it looks in the box.
const sel = (marked: string): [string, number, number] => {
  const start = marked.indexOf('[')
  const end = marked.indexOf(']') - 1
  return [marked.replace('[', '').replace(']', ''), start, end]
}
const show = ({ text, start, end }: WhatsAppEdit) => text.slice(0, start) + '[' + text.slice(start, end) + ']' + text.slice(end)

describe('toggleWhatsAppStyle', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(show(toggleWhatsAppStyle(...sel('Hola [Ana], bienvenida'), 'bold'))).toBe('Hola *[Ana]*, bienvenida')
    expect(show(toggleWhatsAppStyle(...sel('[tu cita]'), 'italic'))).toBe('_[tu cita]_')
    expect(show(toggleWhatsAppStyle(...sel('precio [40 €]'), 'strike'))).toBe('precio ~[40 €]~')
    expect(show(toggleWhatsAppStyle(...sel('código [ABC10]'), 'code'))).toBe('código `[ABC10]`')
    expect(show(toggleWhatsAppStyle(...sel('código [ABC10]'), 'mono'))).toBe('código ```[ABC10]```')
  })

  it('puts the markers against the text, not around the spaces at its edges', () => {
    expect(show(toggleWhatsAppStyle(...sel('Hola[ Ana ]hoy'), 'bold'))).toBe('Hola *[Ana]* hoy')
  })

  it('with nothing selected, leaves an empty pair with the cursor inside', () => {
    expect(show(toggleWhatsAppStyle(...sel('Hola []'), 'bold'))).toBe('Hola *[]*')
    expect(show(toggleWhatsAppStyle(...sel('[]'), 'mono'))).toBe('```[]```')
    // Only spaces selected counts as nothing: they are kept.
    expect(show(toggleWhatsAppStyle(...sel('a[  ]b'), 'italic'))).toBe('a  _[]_b')
  })

  it('unwraps when the markers are just outside the selection', () => {
    expect(show(toggleWhatsAppStyle(...sel('Hola *[Ana]*'), 'bold'))).toBe('Hola [Ana]')
    expect(show(toggleWhatsAppStyle(...sel('```[x]```'), 'mono'))).toBe('[x]')
  })

  it('unwraps when the selection takes the markers in', () => {
    expect(show(toggleWhatsAppStyle(...sel('Hola [*Ana*]'), 'bold'))).toBe('Hola [Ana]')
    expect(show(toggleWhatsAppStyle(...sel('[~40 €~]'), 'strike'))).toBe('[40 €]')
  })

  it('round-trips: wrapping twice gives back the original', () => {
    for (const style of ['bold', 'italic', 'strike', 'mono', 'code'] as const) {
      const once = toggleWhatsAppStyle(...sel('Hola [Ana] y más'), style)
      const twice = toggleWhatsAppStyle(once.text, once.start, once.end, style)
      expect(show(twice)).toBe('Hola [Ana] y más')
    }
  })

  it('does not take inline code for one tick of a monospace block', () => {
    // The ``` around "x" is not a pair of `, so there is nothing to take off.
    expect(toggleWhatsAppStyle(...sel('```[x]```'), 'code').text).toBe('````x````')
  })

  it('adds another style around one already there', () => {
    expect(show(toggleWhatsAppStyle(...sel('[*Ana*]'), 'italic'))).toBe('_[*Ana*]_')
  })

  it('wraps each line on its own, because WhatsApp draws them within a line', () => {
    expect(show(toggleWhatsAppStyle(...sel('[uno\n\ndos]'), 'bold'))).toBe('*[uno*\n\n*dos]*')
    const back = toggleWhatsAppStyle('*uno*\n\n*dos*', 0, 13, 'bold')
    expect(back.text).toBe('uno\n\ndos')
  })

  it('wraps several lines in one monospace block', () => {
    expect(toggleWhatsAppStyle('uno\ndos', 0, 7, 'mono').text).toBe('```uno\ndos```')
  })
})

describe('toggleWhatsAppLines', () => {
  it('makes the lines a bulleted list, and takes it off again', () => {
    const on = toggleWhatsAppLines('Trae:\nropa cómoda\ntoalla', 6, 24, 'bullet')
    expect(on.text).toBe('Trae:\n- ropa cómoda\n- toalla')
    expect(toggleWhatsAppLines(on.text, on.start, on.end, 'bullet').text).toBe('Trae:\nropa cómoda\ntoalla')
  })

  it('numbers the lines, skipping empty ones', () => {
    expect(toggleWhatsAppLines('uno\n\ndos\ntres', 0, 13, 'numbered').text).toBe('1. uno\n\n2. dos\n3. tres')
  })

  it('turns one kind of list into another', () => {
    expect(toggleWhatsAppLines('- uno\n- dos', 0, 11, 'numbered').text).toBe('1. uno\n2. dos')
  })

  it('works on the line the cursor is on', () => {
    const r = toggleWhatsAppLines('Hola\nnota importante\nAdiós', 8, 8, 'quote')
    expect(r.text).toBe('Hola\n> nota importante\nAdiós')
    expect(r.start).toBe(r.end)
    expect(r.start).toBe('Hola\n> nota importante'.length)
  })

  it('starts a list on an empty line', () => {
    expect(toggleWhatsAppLines('', 0, 0, 'bullet')).toEqual({ text: '- ', start: 2, end: 2 })
  })

  it('does not reach into the line a selection ends at the start of', () => {
    expect(toggleWhatsAppLines('uno\ndos', 0, 4, 'quote').text).toBe('> uno\ndos')
  })
})

describe('insertWhatsAppText', () => {
  it('replaces the selection and leaves the cursor after', () => {
    expect(show(insertWhatsAppText(...sel('Hola [x] Ana'), '👋'))).toBe('Hola 👋[] Ana')
  })
})

describe('parseWhatsAppText', () => {
  const runs = (text: string) => parseWhatsAppText(text)[0]!.runs

  it('reads each style', () => {
    expect(runs('Hola *Ana*, _hoy_ ~no~ `A1` ```x```')).toEqual([
      { text: 'Hola ', styles: [] },
      { text: 'Ana', styles: ['bold'] },
      { text: ', ', styles: [] },
      { text: 'hoy', styles: ['italic'] },
      { text: ' ', styles: [] },
      { text: 'no', styles: ['strike'] },
      { text: ' ', styles: [] },
      { text: 'A1', styles: ['code'] },
      { text: ' ', styles: [] },
      { text: 'x', styles: ['mono'] },
    ])
  })

  it('nests styles', () => {
    expect(runs('*_ambas_*')).toEqual([{ text: 'ambas', styles: ['bold', 'italic'] }])
  })

  it('leaves markers alone that WhatsApp would not draw', () => {
    for (const text of ['snake_case_name', '2*3*4', 'a * no *', 'a ** b', '*sin cerrar', 'precio_*']) {
      expect(runs(text)).toEqual([{ text, styles: [] }])
    }
  })

  it('formats nothing inside code', () => {
    expect(runs('`*no*`')).toEqual([{ text: '*no*', styles: ['code'] }])
  })

  it('reads lists and quotes', () => {
    expect(parseWhatsAppText('- uno\n* dos\n3. tres\n> cita\nfin').map((l) => [l.kind, l.marker, l.runs[0]?.text])).toEqual([
      ['bullet', '•', 'uno'],
      ['bullet', '•', 'dos'],
      ['numbered', '3.', 'tres'],
      ['quote', '', 'cita'],
      ['text', '', 'fin'],
    ])
  })

  it('formats a variable once its example is in', () => {
    expect(runs('Hola *Ana*')[1]).toEqual({ text: 'Ana', styles: ['bold'] })
  })
})
