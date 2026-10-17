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
// The send itself is inserted as the staff member, so the learn_sends policy
// (the patient record's scope) decides whether they may send to this patient
// at all; delivery then runs on the service role.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId?: string; articleId?: string }>(event)
  if (!body?.patientId || !body.articleId) throw createError({ statusCode: 400, statusMessage: 'patientId and articleId are required' })
  const { supabase, teamMember } = await requireTeamMember(event)

  const { data: article } = await supabase.from('learn_articles').select('id, title, summary').eq('id', body.articleId).is('archived_at', null).maybeSingle()
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Article not found' })
  const { data: sent, error } = await supabase
    .from('learn_sends')
    .insert({ account_id: teamMember.account_id, patient_id: body.patientId, article_id: article.id, sent_by: teamMember.id })
    .select('id, token')
    .single()
  if (error || !sent) throw createError({ statusCode: error?.code === '42501' ? 403 : 400, statusMessage: error?.message ?? 'Could not send' })

  const service = serverSupabaseServiceRole<Database>(event)
  const url = `${getRequestURL(event).origin}/aprende/${sent.token}`
  let channel: 'app' | 'email' | 'link' = 'link'
  try {
    const push = await sendPushToPatients(service, teamMember.account_id, [body.patientId], {
      title: 'Nueva lectura de tu clínica',
      body: article.title,
      data: { type: 'learn', sendId: sent.id },
    })
    if (push.delivered > 0) channel = 'app'
  } catch (e) {
    console.error('[learn-send] push failed', sent.id, e)
  }
  if (channel === 'link') {
    const [{ data: patient }, { data: account }] = await Promise.all([
      service.from('patients').select('first_name, email, do_not_contact').eq('id', body.patientId).eq('account_id', teamMember.account_id).maybeSingle(),
      service.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle(),
    ])
    if (patient?.email && !patient.do_not_contact) {
      const clinic = account?.name ?? 'Tu clínica'
      try {
        await sendResendEmail({
          to: patient.email,
          subject: `${article.title} · ${clinic}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#22252F">
            <p>Hola${patient.first_name ? ` ${esc(patient.first_name)}` : ''},</p>
            <p>En ${esc(clinic)} te hemos preparado esta lectura:</p>
            <p style="font-size:18px;font-weight:700;margin:16px 0 4px">${esc(article.title)}</p>
            ${article.summary ? `<p style="color:#4A4F60;margin:0 0 16px">${esc(article.summary)}</p>` : ''}
            <p><a href="${url}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Leer</a></p>
          </div>`,
        })
        channel = 'email'
      } catch (e) {
        console.error('[learn-send] email failed', sent.id, e)
      }
    }
  }
  await service.from('learn_sends').update({ channel }).eq('id', sent.id)
  return { sendId: sent.id, channel, url }
})
