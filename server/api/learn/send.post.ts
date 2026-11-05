import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToPatients } from '~/server/utils/pushNotifications'
import { sendResendEmail } from '~/server/utils/resend'

// "Enviar lectura" on a patient record: one article from the clinic's
// library, delivered the best way the patient can receive it -- a push to
// their app; else an email with the no-login link; else the link handed back
// for the practitioner to paste into WhatsApp. learn_sends.channel records
// which, and the record shows it.
//
// The habits pack (Settings > Care plans, sent from the review card) comes
// through here too, as articleIds: several readings in their order, one push
// and one email for all of them, and any the patient has already been sent
// left out rather than sent twice.
//
// The send itself is inserted as the staff member, so the learn_sends policy
// (the patient record's scope) decides whether they may send to this patient
// at all; delivery then runs on the service role.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId?: string; articleId?: string; articleIds?: string[] }>(event)
  const pack = Array.isArray(body?.articleIds)
  const requested = pack ? [...new Set(body!.articleIds!.filter((id) => typeof id === 'string'))].slice(0, 20) : body?.articleId ? [body.articleId] : []
  if (!body?.patientId || !requested.length) throw createError({ statusCode: 400, statusMessage: 'patientId and articleId are required' })
  const { supabase, teamMember } = await requireTeamMember(event)

  const { data: found } = await supabase.from('learn_articles').select('id, title, summary').in('id', requested).is('archived_at', null)
  // In the order asked for, which for the pack is the order the clinic set.
  let articles = requested.map((id) => (found ?? []).find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a)
  if (!articles.length) throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  let skipped = 0
  if (pack) {
    const { data: already } = await supabase.from('learn_sends').select('article_id').eq('patient_id', body.patientId).in('article_id', articles.map((a) => a.id))
    const had = new Set((already ?? []).map((s) => s.article_id))
    skipped = articles.filter((a) => had.has(a.id)).length
    articles = articles.filter((a) => !had.has(a.id))
    if (!articles.length) return { sends: [], skipped, channel: null, url: null }
  }
  const { data: sent, error } = await supabase
    .from('learn_sends')
    .insert(articles.map((a) => ({ account_id: teamMember.account_id, patient_id: body.patientId!, article_id: a.id, sent_by: teamMember.id })))
    .select('id, token, article_id')
  if (error || !sent?.length) throw createError({ statusCode: error?.code === '42501' ? 403 : 400, statusMessage: error?.message ?? 'Could not send' })
  const sends = articles.map((a) => ({ article: a, send: sent.find((s) => s.article_id === a.id)! }))

  const service = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin
  const urlOf = (token: string) => `${origin}/aprende/${token}`
  const first = sends[0]!
  let channel: 'app' | 'email' | 'link' = 'link'
  try {
    const push = await sendPushToPatients(service, teamMember.account_id, [body.patientId], {
      title: sends.length === 1 ? 'Nueva lectura de tu clínica' : `${sends.length} lecturas nuevas de tu clínica`,
      body: sends.map((s) => s.article.title).join(' · '),
      data: { type: 'learn', sendId: first.send.id },
    })
    if (push.delivered > 0) channel = 'app'
  } catch (e) {
    console.error('[learn-send] push failed', first.send.id, e)
  }
  if (channel === 'link') {
    const [{ data: patient }, { data: account }] = await Promise.all([
      service.from('patients').select('first_name, email, do_not_contact').eq('id', body.patientId).eq('account_id', teamMember.account_id).maybeSingle(),
      service.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle(),
    ])
    if (patient?.email && !patient.do_not_contact) {
      const clinic = account?.name ?? 'Tu clínica'
      const items = sends
        .map(
          ({ article, send }) => `<p style="font-size:18px;font-weight:700;margin:16px 0 4px">${esc(article.title)}</p>
            ${article.summary ? `<p style="color:#4A4F60;margin:0 0 16px">${esc(article.summary)}</p>` : ''}
            <p><a href="${urlOf(send.token)}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Leer</a></p>`,
        )
        .join('')
      try {
        await sendResendEmail({
          to: patient.email,
          subject: sends.length === 1 ? `${first.article.title} · ${clinic}` : `${sends.length} lecturas para ti · ${clinic}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#22252F">
            <p>Hola${patient.first_name ? ` ${esc(patient.first_name)}` : ''},</p>
            <p>En ${esc(clinic)} te hemos preparado ${sends.length === 1 ? 'esta lectura' : 'estas lecturas'}:</p>
            ${items}
          </div>`,
        })
        channel = 'email'
      } catch (e) {
        console.error('[learn-send] email failed', first.send.id, e)
      }
    }
  }
  await service.from('learn_sends').update({ channel }).in('id', sends.map((s) => s.send.id))
  if (pack) return { sends: sends.map((s) => ({ articleId: s.article.id, sendId: s.send.id, url: urlOf(s.send.token) })), skipped, channel, url: urlOf(first.send.token) }
  return { sendId: first.send.id, channel, url: urlOf(first.send.token) }
})
