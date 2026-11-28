import { describe, expect, it } from 'vitest'
import {
  estimateLearnMinutes,
  learnBlocksFromHtml,
  learnBlocksFromText,
  learnContentPlainText,
  learnInLanguage,
  learnRunsFromHtml,
  learnRunsToHtml,
  normalizeLearnContent,
  normalizeLearnTranslations,
  type LearnTextBlock,
} from '../../utils/learnContent'

const ACCOUNT = '11111111-2222-3333-4444-555555555555'

describe('normalizeLearnContent', () => {
  it('keeps the blocks it knows and drops the rest', () => {
    const blocks = normalizeLearnContent([
      { id: 'a', type: 'heading', runs: [{ text: 'Hola', bold: true }] },
      { id: 'b', type: 'script', runs: [{ text: 'x' }] },
      { id: 'c', type: 'image', path: `${ACCOUNT}/foto.jpg`, caption: 'Pie' },
      { id: 'd', type: 'image', path: 'https://evil.example/x.jpg' },
      { id: 'e', type: 'divider' },
      'nonsense',
    ])
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'image', 'divider'])
  })

  it('keeps only links a reader can safely follow', () => {
    const [b] = normalizeLearnContent([
      {
        id: 'a',
        type: 'paragraph',
        runs: [
          { text: 'uno ', href: 'javascript:alert(1)' },
          { text: 'dos', href: 'https://quiroflow.com' },
          { text: ' tres', href: 'www.example.com/x' },
        ],
      },
    ]) as [LearnTextBlock]
    expect(b.runs).toEqual([{ text: 'uno ' }, { text: 'dos', href: 'https://quiroflow.com' }, { text: ' tres', href: 'https://www.example.com/x' }])
  })

  it('gives a repeated id a new one', () => {
    const blocks = normalizeLearnContent([
      { id: 'a', type: 'paragraph', runs: [] },
      { id: 'a', type: 'paragraph', runs: [] },
    ])
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2)
  })
})

describe('inline HTML', () => {
  it('reads formats, links and line breaks, and nothing else', () => {
    const runs = learnRunsFromHtml('Hola <b>mundo <i>feliz</i></b><br><a href="https://x.es" onclick="bad()">enlace</a><script>alert(1)</script><img src=x onerror=bad()>')
    expect(runs).toEqual([{ text: 'Hola ' }, { text: 'mundo ', bold: true }, { text: 'feliz', bold: true, italic: true }, { text: '\n' }, { text: 'enlace', href: 'https://x.es' }])
  })

  it('reads a browser’s styled spans and <div> lines', () => {
    expect(learnRunsFromHtml('<span style="font-weight: 700">a</span><div>b</div>')).toEqual([{ text: 'a', bold: true }, { text: '\nb' }])
  })

  it('round-trips through the editor’s HTML', () => {
    const runs = [{ text: 'a <b>&', bold: true as const }, { text: ' c', href: 'https://x.es' }, { text: '\nd', strike: true as const }]
    expect(learnRunsFromHtml(learnRunsToHtml(runs))).toEqual(runs)
  })
})

describe('pasting', () => {
  it('turns HTML into headings, lists, quotes and paragraphs', () => {
    const blocks = learnBlocksFromHtml('<h1>Título</h1><p>Texto <b>fuerte</b></p><ul><li>uno<li>dos</ul><ol><li>primero</li></ol><blockquote>cita</blockquote><hr><p>fin</p><img src="https://x/y.png">')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bullet', 'bullet', 'number', 'quote', 'divider', 'paragraph'])
  })

  it('turns plain text into paragraphs and lists', () => {
    const blocks = learnBlocksFromText('# Agua\n\nBebe a menudo.\nSobre todo:\n- al despertar\n• antes de comer\n1. uno\n\nFin.')
    expect(blocks.map((b) => [b.type, b.runs[0]!.text])).toEqual([
      ['heading', 'Agua'],
      ['paragraph', 'Bebe a menudo.\nSobre todo:'],
      ['bullet', 'al despertar'],
      ['bullet', 'antes de comer'],
      ['number', 'uno'],
      ['paragraph', 'Fin.'],
    ])
  })
})

describe('plain text', () => {
  it('is what older apps read in body', () => {
    const blocks = normalizeLearnContent([
      { id: '1', type: 'heading', runs: [{ text: 'Cuándo beber' }] },
      { id: '2', type: 'bullet', runs: [{ text: 'Al despertar' }] },
      { id: '3', type: 'bullet', runs: [{ text: 'Antes de dormir' }] },
      { id: '4', type: 'image', path: `${ACCOUNT}/a.png` },
      { id: '5', type: 'number', runs: [{ text: 'Uno' }] },
      { id: '6', type: 'number', runs: [{ text: 'Dos' }] },
    ])
    expect(learnContentPlainText(blocks)).toBe('Cuándo beber\n\n• Al despertar\n• Antes de dormir\n\n1. Uno\n2. Dos')
  })

  it('estimates the reading time', () => {
    expect(estimateLearnMinutes([])).toBe(null)
    expect(estimateLearnMinutes([{ id: '1', type: 'paragraph', runs: [{ text: 'palabra '.repeat(540) }] }])).toBe(3)
  })
})

describe('languages', () => {
  const article = {
    title: 'Agua',
    summary: 'Cuándo beber',
    body: 'Uno.\n\nDos.',
    content: [],
    translations: { en: { title: 'Water', summary: '', content: [{ id: 'x', type: 'paragraph', runs: [{ text: 'One.' }] }] }, de: { title: 'Wasser' } },
  }

  it('shows the translation in the patient’s language, part by part', () => {
    const en = learnInLanguage(article, 'en')
    expect(en.language).toBe('en')
    expect(en.title).toBe('Water')
    // No English summary yet: the original's.
    expect(en.summary).toBe('Cuándo beber')
    expect(en.content).toHaveLength(1)
  })

  it('falls back to the original, read from body when it has no blocks', () => {
    const fr = learnInLanguage(article, 'fr')
    expect(fr.language).toBe(null)
    expect(fr.title).toBe('Agua')
    expect(fr.content.map((b) => b.type === 'paragraph' && b.runs[0]!.text)).toEqual(['Uno.', 'Dos.'])
    expect(learnInLanguage(article, null).title).toBe('Agua')
  })

  it('reads only the languages it supports', () => {
    expect(Object.keys(normalizeLearnTranslations(article.translations))).toEqual(['en'])
  })
})
