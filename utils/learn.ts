// Patient education (learn_articles / learn_sends): the tags an article can
// carry, which articles to put first for a patient, and how an article's
// text and video are shown. Shared by the web, the staff app and the
// patient app, so it imports nothing.

/** Tag key → label, in the order the library's filter shows them. */
export const LEARN_TAGS: Record<string, string> = {
  habitos: 'Hábitos',
  primera_visita: 'Primera visita',
  lumbar: 'Lumbar',
  cervical: 'Cervical',
  cefalea: 'Cefalea',
  trabajo: 'Trabajo y postura',
  embarazo: 'Embarazo',
  general: 'General',
}

/**
 * A tag as shown: a built-in one by its label, a clinic's own as it was
 * written. Tags are free text in learn_articles.tags; a clinic adds its own
 * ("Nutrición", "Órganos"...) beside the built-in keys above.
 */
export function learnTagLabel(tag: string): string {
  return LEARN_TAGS[tag] ?? tag
}

/** A tag a clinic typed, tidied: trimmed, single-spaced, at most 40 characters. */
export function cleanLearnTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').slice(0, 40)
}

/**
 * The tags to offer as filters or choices: the built-in ones in their own
 * order (all of them, or only those in use), then the clinic's own that any
 * article carries, alphabetically.
 */
export function learnTagsInUse(articles: { tags: string[] }[], opts: { allBuiltIn?: boolean } = {}): string[] {
  const used = new Set(articles.flatMap((a) => a.tags))
  const builtIn = Object.keys(LEARN_TAGS).filter((k) => opts.allBuiltIn || used.has(k))
  const own = [...used].filter((k) => !(k in LEARN_TAGS)).sort((a, b) => a.localeCompare(b, 'es'))
  return [...builtIn, ...own]
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

/**
 * A still of a YouTube link, for a list to show before anything is played
 * (i.ytimg.com sets no cookies). Null for anything else: Vimeo has none
 * without a call to its API.
 */
export function videoThumbnailUrl(url: string | null | undefined): string | null {
  const id = videoEmbedUrl(url)?.match(/^https:\/\/www\.youtube-nocookie\.com\/embed\/([\w-]+)$/)?.[1]
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null
}
