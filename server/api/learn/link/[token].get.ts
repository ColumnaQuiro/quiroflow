import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { learnContentImagePaths, learnInLanguage } from '~/utils/learnContent'

// An article opened from its no-login link (/aprende/<token>), for a patient
// without the app. No session -- the token is the key, as with satisfaction
// and waitlist links. The first open marks the send read. In the language on
// the patient's record when the article has it (utils/learnContent.ts); its
// video, cover and images are signed here, since the reader has no session.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token || !/^[0-9a-f]{20,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data } = await supabase
    .from('learn_sends')
    .select('id, opened_at, accounts(name), patients(preferred_language), learn_articles(title, summary, body, content, translations, video_url, media_path, cover_path, minutes, exercise_programs(name))')
    .eq('token', token)
    .maybeSingle()
  const send = data as unknown as {
    id: string
    opened_at: string | null
    accounts: { name: string } | null
    patients: { preferred_language: string | null } | null
    learn_articles: { title: string; summary: string | null; body: string; content: unknown; translations: unknown; video_url: string | null; media_path: string | null; cover_path: string | null; minutes: number | null; exercise_programs: { name: string } | null } | null
  } | null
  if (!send?.learn_articles) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  if (!send.opened_at) await supabase.from('learn_sends').update({ opened_at: new Date().toISOString() }).eq('id', send.id).is('opened_at', null)
  const a = send.learn_articles
  const text = learnInLanguage(a, send.patients?.preferred_language)
  const paths = [...new Set([a.media_path, a.cover_path, ...learnContentImagePaths(text.content)].filter((p): p is string => !!p))]
  const signed: Record<string, string> = {}
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('learn-media').createSignedUrls(paths, 3600)
    for (const u of urls ?? []) if (u.path && u.signedUrl && !u.error) signed[u.path] = u.signedUrl
  }
  const mediaSrc = a.media_path ? (signed[a.media_path] ?? null) : null
  const coverSrc = a.cover_path ? (signed[a.cover_path] ?? null) : null
  const images = Object.fromEntries(learnContentImagePaths(text.content).filter((p) => signed[p]).map((p) => [p, signed[p]!]))
  return {
    clinicName: send.accounts?.name ?? '',
    title: text.title,
    summary: text.summary,
    body: a.body,
    content: text.content,
    language: text.language,
    images,
    coverSrc,
    mediaSrc,
    videoUrl: a.video_url,
    minutes: a.minutes,
    programName: a.exercise_programs?.name ?? null,
  }
})
