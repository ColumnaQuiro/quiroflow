import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToPatients } from '~/server/utils/pushNotifications'

// "Avisar al publicar" in Ajustes › Educación: one push, to every patient of
// the clinic with the app, saying a library article is up. Once per article,
// ever: announced_at is stamped in the same statement that checks it is
// still null, so a second click, a second tab or an edit later never pushes
// it again. The stamp goes first -- a lock screen cannot be recalled, a
// missed announcement can be lived with.
//
// Recorded in patient_push_broadcasts like any other clinic-wide push
// (server/api/patient-push/send.post.ts), so Reports › Communications sees it.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'clinic_config')
  const body = await readBody<{ articleId?: string }>(event)
  if (!body?.articleId) throw createError({ statusCode: 400, statusMessage: 'articleId is required' })

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: article } = await service
    .from('learn_articles')
    .update({ announced_at: new Date().toISOString() })
    .eq('id', body.articleId)
    .eq('account_id', teamMember.account_id)
    .eq('visible_to_patients', true)
    .is('archived_at', null)
    .is('announced_at', null)
    .select('id, title, media_path, video_url')
    .maybeSingle()
  if (!article) throw createError({ statusCode: 409, statusMessage: 'Already announced, or not visible to patients' })

  const { data: account } = await service.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle()
  const kind = article.media_path || article.video_url ? 'vídeo nuevo' : 'lectura nueva'
  // A notification title past ~64 characters is cut by the phone.
  const title = `${(account?.name ?? 'Tu clínica').slice(0, 64 - kind.length - 3)} · ${kind}`
  const result = await sendPushToPatients(service, teamMember.account_id, null, {
    title,
    body: article.title,
    data: { type: 'learn_library', articleId: article.id },
  })

  await service.from('patient_push_broadcasts').insert({
    account_id: teamMember.account_id,
    sent_by: teamMember.id,
    title,
    body: article.title,
    patient_ids: null,
    recipients_count: result.recipients,
    delivered_count: result.delivered,
  })

  return { recipients: result.recipients, delivered: result.delivered }
})
