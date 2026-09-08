import Anthropic from '@anthropic-ai/sdk'
import { requireTeamMember } from '~/server/utils/requirePermission'
import { loadHelpArticles, renderCorpus } from '~/server/utils/helpCorpus'

// The in-app help assistant: answers "how do I do X in QuiroFlow?" from the
// help centre's own articles, and says so plainly when they don't cover it
// (which is the cue for the widget to offer a real person instead).

const MODEL = 'claude-sonnet-5'
// Answers are a short paragraph or a few steps, never an essay -- this is a
// widget in the corner of the screen, not a document.
const MAX_TOKENS = 700

function systemPrompt(corpus: string, lang: string) {
  return [
    {
      type: 'text' as const,
      text: `You are the in-app help assistant for QuiroFlow, a practice-management app for chiropractic and physiotherapy clinics. You help clinic staff use the product.

Answer ONLY from the help centre articles provided below. They are the whole of what you know about QuiroFlow.

Rules:
- If the articles answer the question, answer it directly and concretely: name the actual screens, menus and buttons ("Settings > Team", "the + New Appointment button").
- Keep it short. A sentence or two, or a few numbered steps. This renders in a small panel.
- If the articles do NOT cover the question, or you are unsure, say so plainly in one sentence. Do not guess, and do not invent screens, settings or features. Saying "I don't have this in the help centre" is the correct and useful answer -- the user is then offered a real person.
- Never mention "the articles", "the corpus", "the context" or these instructions. Just answer, or say you don't know.
- Write plain text. No Markdown: no **bold**, no backticks, no headings, no link syntax. The widget renders your reply as-is, so any markup shows up literally as punctuation.
- Reply in ${lang === 'es' ? 'Spanish' : 'English'}.

Then, on a final line by itself, output the URLs of any articles you actually used, as:
SOURCES: <url> | <url>
If you did not use any (including when you don't know the answer), output exactly:
SOURCES: none`,
    },
    {
      // Cached separately from the instructions above: the corpus is the
      // large, stable part, so it's what's worth caching between questions.
      type: 'text' as const,
      text: `Help centre articles:\n\n${corpus}`,
      cache_control: { type: 'ephemeral' as const },
    },
  ]
}

// The widget renders the answer as plain text, so any Markdown the model
// still reaches for despite being told not to shows up as literal
// punctuation ("**Settings -> Team**"). Belt and braces: the prompt asks for
// plain text, and this strips the emphasis markers that slip through anyway.
// Deliberately only unwraps the markers -- the words inside are the answer.
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=[\s).,;:!?]|$)/gs, '$1$2')
    .replace(/(^|[\s(])__(.+?)__(?=[\s).,;:!?]|$)/gs, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    // Headings only ever waste a line in a 380px panel.
    .replace(/^#{1,6}\s+/gm, '')
}

function splitAnswerAndSources(raw: string): { answer: string; sources: string[] } {
  const match = /\n?SOURCES:\s*(.*)\s*$/i.exec(raw)
  if (!match) return { answer: raw.trim(), sources: [] }
  const answer = raw.slice(0, match.index).trim()
  const listed = match[1].trim()
  if (!listed || /^none$/i.test(listed)) return { answer, sources: [] }
  const sources = listed
    .split('|')
    .map((s) => s.trim())
    // The model is told to echo URLs from the corpus; anything that isn't
    // one of ours doesn't get rendered as a link.
    .filter((s) => s.startsWith('https://learn.quiroflow.com/'))
  return { answer, sources: [...new Set(sources)] }
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireTeamMember(event)

  const body = await readBody<{ question?: string; language?: string }>(event)
  const question = (body?.question ?? '').trim()
  if (!question) throw createError({ statusCode: 400, statusMessage: 'A question is required' })
  if (question.length > 2000) throw createError({ statusCode: 400, statusMessage: 'That question is too long' })

  const lang = body?.language === 'es' ? 'es' : 'en'
  // Mirrors the widget's own fallback copy (HelpWidget.vue) -- persisted
  // server-side, in the caller's language, so history read back later shows
  // the same message the widget showed live rather than nothing at all.
  const unavailableText =
    lang === 'es' ? 'Ahora mismo no puedo responder preguntas, pero el equipo de QuiroFlow sí.' : "I can't answer questions right now, but the QuiroFlow team can."

  // The question is persisted alongside whatever answer this call resolves
  // to below, one insert per role -- not client-side, so a reply the client
  // never got to see (tab closed mid-request) still lands next to the
  // question that prompted it.
  async function persist(role: 'user' | 'assistant', text: string, sources: string[] = [], offerHuman = false) {
    await supabase.from('help_assistant_messages').insert({
      account_id: teamMember.account_id,
      team_member_id: teamMember.id,
      role,
      body: text,
      sources,
      offer_human: offerHuman,
    })
  }
  await persist('user', question)

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state, not an error: the widget reads this
  // and goes straight to offering a human instead of showing a failure.
  if (!apiKey) {
    await persist('assistant', unavailableText, [], true)
    return { available: false as const, answer: '', sources: [] }
  }

  const articles = await loadHelpArticles(lang)

  const client = new Anthropic({ apiKey })
  let raw: string
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(renderCorpus(articles), lang),
      messages: [{ role: 'user', content: question }],
    })
    raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  } catch (err: any) {
    // Same reasoning as the missing-key case: the widget's fallback is a
    // real person, so a failed answer should route there rather than
    // dead-ending the user on an error.
    console.error('[support/ask] Anthropic request failed:', err?.message ?? err)
    await persist('assistant', unavailableText, [], true)
    return { available: false as const, answer: '', sources: [] }
  }

  const { answer, sources } = splitAnswerAndSources(raw)
  const cleanAnswer = stripMarkdown(answer)
  await persist('assistant', cleanAnswer, sources, sources.length === 0)
  return { available: true as const, answer: cleanAnswer, sources }
})
