import { sendResendEmail } from '~/server/utils/resend'

// Send a patient a plain message by email.
//
// This exists because of a WhatsApp message that fails. WhatsApp refuses for
// reasons that have nothing to do with the patient being reachable -- the
// 24-hour window closed, the template was never approved, the number is not
// opted in -- and in every one of those cases the clinic still has an email
// address and something that needs saying. Until now the only way to use it
// was to leave the app.
//
// Deliberately not a template system. The caller supplies the words, which
// for the fallback path are the words WhatsApp would have sent, so nobody
// has to rewrite the message to send it a second way.
//
// The guards are the same three the WhatsApp sender applies, and for the
// same reasons: a minor's messages go to their tutor, a do-not-contact
// patient is not contacted on any channel, and neither rule is worth
// re-deciding per channel.
export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const body = await readBody<{ subject?: string; body?: string }>(event)
  if (!patientId || !body?.body?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'A message body is required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'recalls_access')

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, email, is_minor, do_not_contact')
    .eq('id', patientId)
    .maybeSingle()
  if (!patient) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }
  if (patient.is_minor || patient.do_not_contact) {
    throw createError({ statusCode: 400, statusMessage: 'This patient must not be contacted directly' })
  }
  if (!patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  const subject = body.subject?.trim() || 'A message from your clinic'
  // The body arrives as the plain text a person typed or a template
  // rendered. Escaped, then newlines become breaks -- so a message cannot
  // carry markup into the patient's inbox, and a two-paragraph message does
  // not arrive as one run-on line.
  const escaped = body.body
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">
      <p>Hola ${patient.first_name},</p>
      <p>${escaped}</p>
    </div>`

  const sent = await sendResendEmail({ to: patient.email, subject, html })

  // Recorded after the send and never allowed to fail it: the mail has gone
  // by this point, and throwing over a bookkeeping row would tell the caller
  // it never went and invite them to send it twice.
  if (sent.id) {
    const { error } = await supabase.from('email_messages').insert({
      account_id: teamMember.account_id,
      provider_message_id: sent.id,
      patient_id: patient.id,
      recipient_email: patient.email,
      subject,
    })
    if (error) console.error(`[patients] could not record email ${sent.id}: ${error.message}`)
  }

  return { sent: true, to: patient.email }
})
