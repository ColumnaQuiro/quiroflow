// The help centre's articles, fetched from learn.quiroflow.com's build
// artifact (see that repo's scripts/build-corpus.mjs).
//
// The whole corpus is ~180 KB of text across both languages, which is small
// enough to hand the model in full on every question. That's a deliberate
// choice over the usual embeddings-and-retrieval setup: no pgvector, no
// ingestion job, no chunking, nothing to re-index when an article changes --
// and the model gets to see every article at once, so it answers questions
// that span several of them instead of whatever three chunks scored highest.
// Prompt caching keeps the cost of resending it negligible.

export interface HelpArticle {
  lang: string
  slug: string
  url: string
  title: string
  description: string
  collection: string
  body: string
}

interface Cached {
  articles: HelpArticle[]
  fetchedAt: number
}

// Module scope: one fetch per server instance per hour, not per question.
let cache: Cached | null = null
const TTL_MS = 60 * 60 * 1000

export async function loadHelpArticles(lang: string): Promise<HelpArticle[]> {
  const url = useRuntimeConfig().helpCorpusUrl
  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) {
    try {
      const data = await $fetch<{ articles: HelpArticle[] }>(url, { timeout: 10000 })
      cache = { articles: data.articles ?? [], fetchedAt: Date.now() }
    } catch {
      // Serve a stale corpus rather than no corpus -- the help centre being
      // briefly unreachable shouldn't take the assistant down with it. Only
      // if we've never had one does this actually fail.
      if (!cache) throw createError({ statusCode: 503, statusMessage: 'Help centre is unavailable right now' })
    }
  }

  const wanted = cache!.articles.filter((a) => a.lang === lang)
  // Spanish and English hold the same articles, so falling back to whatever
  // exists is better than answering "I don't know" because one language's
  // set failed to build.
  return wanted.length > 0 ? wanted : cache!.articles
}

export function renderCorpus(articles: HelpArticle[]): string {
  return articles
    .map((a) => `<article url="${a.url}" title="${a.title}" section="${a.collection}">\n${a.body}\n</article>`)
    .join('\n\n')
}
