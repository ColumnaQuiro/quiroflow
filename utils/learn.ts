// Patient education (learn_articles / learn_sends): the tags an article can
// carry, which articles to put first for a patient, and how an article's
// text and video are shown. Shared by the web, the staff app and the
// patient app, so it imports nothing.

/** Tag key → label, in the order the library's filter shows them. */
export const LEARN_TAGS: Record<string, string> = {
  primera_visita: 'Primera visita',
  lumbar: 'Lumbar',
  cervical: 'Cervical',
  cefalea: 'Cefalea',
  trabajo: 'Trabajo y postura',
  embarazo: 'Embarazo',
  general: 'General',
}

// Words in a patient's motivo de consulta or diagnosis that point at a tag.
const TAG_WORDS: Record<string, string[]> = {
  lumbar: ['lumbar', 'lumbalgia', 'espalda baja', 'ciatic', 'ciátic', 'hernia', 'disco', 'sacro', 'cadera'],
  cervical: ['cervical', 'cuello', 'nuca', 'cervicalgia', 'latigazo', 'trapecio'],
  cefalea: ['cefalea', 'cabeza', 'migraña', 'jaqueca'],
  trabajo: ['postura', 'oficina', 'ordenador', 'trabajo', 'pantalla'],
  embarazo: ['embaraz', 'gestación', 'gestacion', 'posparto', 'postparto'],
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The tags a patient's complaint and diagnosis point at. */
export function tagsForComplaint(...texts: (string | null | undefined)[]): string[] {
  const text = fold(texts.filter(Boolean).join(' '))
  if (!text) return []
  return Object.entries(TAG_WORDS)
    .filter(([, words]) => words.some((w) => text.includes(fold(w))))
    .map(([tag]) => tag)
}

/**
 * Articles in the order to offer them: those matching the patient's tags
 * first (more matches first), then first-visit ones while they have had at
 * most one visit, then the rest by title.
 */
export function suggestArticles<T extends { title: string; tags: string[] }>(articles: T[], patientTags: string[], opts: { firstVisit?: boolean } = {}): (T & { suggested: boolean })[] {
  const score = (a: T) => a.tags.filter((t) => patientTags.includes(t)).length * 2 + (opts.firstVisit && a.tags.includes('primera_visita') ? 1 : 0)
  return articles
    .map((a) => ({ ...a, suggested: score(a) > 0, s: score(a) }))
    .sort((a, b) => b.s - a.s || a.title.localeCompare(b.title, 'es'))
    .map(({ s: _s, ...a }) => a as T & { suggested: boolean })
}

/** The article's text as paragraphs: a blank line separates them. */
export function articleParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * The embeddable address of a YouTube or Vimeo link, or null for anything
 * else (which is then shown as a plain link, never framed). YouTube goes
 * through youtube-nocookie, which sets no cookies until the video plays.
 */
export function videoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] || null)
  }
  if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/)?.[1]
    if (v) return `https://player.vimeo.com/video/${v}`
  }
  return null
}
