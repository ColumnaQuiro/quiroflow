import { describe, expect, it } from 'vitest'
import { articleParagraphs, LEARN_TAGS, suggestArticles, tagsForComplaint, videoEmbedUrl } from '../../utils/learn'
import { LEARN_STARTER } from '../../utils/learnStarter'

describe('tagsForComplaint', () => {
  it('reads the complaint and the diagnosis, accents or not', () => {
    expect(tagsForComplaint('Dolor de cuello y cabeza', null)).toEqual(['cervical', 'cefalea'])
    expect(tagsForComplaint('lumbalgia', 'Hernia L5-S1')).toEqual(['lumbar'])
    expect(tagsForComplaint('Ciatica derecha')).toEqual(['lumbar'])
    expect(tagsForComplaint('Embarazada de 30 semanas')).toEqual(['embarazo'])
    expect(tagsForComplaint('', null, undefined)).toEqual([])
  })
})

describe('suggestArticles', () => {
  const lib = [
    { title: 'B lumbar', tags: ['lumbar'] },
    { title: 'A cuello y trabajo', tags: ['cervical', 'trabajo'] },
    { title: 'C primera', tags: ['primera_visita'] },
    { title: 'D cuello', tags: ['cervical'] },
  ]
  it('puts more matching tags first, then first-visit ones for a new patient, then by title', () => {
    expect(suggestArticles(lib, ['cervical', 'trabajo'], { firstVisit: true }).map((a) => [a.title, a.suggested])).toEqual([
      ['A cuello y trabajo', true],
      ['D cuello', true],
      ['C primera', true],
      ['B lumbar', false],
    ])
    expect(suggestArticles(lib, []).every((a) => !a.suggested)).toBe(true)
  })
})

describe('videoEmbedUrl', () => {
  it('embeds YouTube without cookies and Vimeo, and nothing else', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871')
    expect(videoEmbedUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBe(null)
    expect(videoEmbedUrl('javascript:alert(1)')).toBe(null)
    expect(videoEmbedUrl('not a url')).toBe(null)
  })
})

describe('the starter articles', () => {
  it('are twelve, keyed once, tagged with known tags, and read as paragraphs', () => {
    expect(LEARN_STARTER).toHaveLength(12)
    expect(new Set(LEARN_STARTER.map((a) => a.key)).size).toBe(12)
    for (const a of LEARN_STARTER) {
      for (const tag of a.tags) expect(LEARN_TAGS[tag], `${a.key}: ${tag}`).toBeTruthy()
      expect(articleParagraphs(a.body).length, a.key).toBeGreaterThanOrEqual(3)
      expect(a.minutes).toBeGreaterThan(0)
    }
  })
})
