import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// An article opened from its no-login link (/aprende/<token>), for a patient
// without the app. No session -- the token is the key, as with satisfaction
// and waitlist links. The first open marks the send read.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token || !/^[0-9a-f]{20,64}$/.test(token)) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data } = await supabase
    .from('learn_sends')
    .select('id, opened_at, accounts(name), learn_articles(title, summary, body, video_url, minutes, exercise_programs(name))')
    .eq('token', token)
    .maybeSingle()
  const send = data as unknown as {
    id: string
    opened_at: string | null
    accounts: { name: string } | null
    learn_articles: { title: string; summary: string | null; body: string; video_url: string | null; minutes: number | null; exercise_programs: { name: string } | null } | null
  } | null
  if (!send?.learn_articles) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  if (!send.opened_at) await supabase.from('learn_sends').update({ opened_at: new Date().toISOString() }).eq('id', send.id).is('opened_at', null)
  const a = send.learn_articles
  return { clinicName: send.accounts?.name ?? '', title: a.title, summary: a.summary, body: a.body, videoUrl: a.video_url, minutes: a.minutes, programName: a.exercise_programs?.name ?? null }
})
