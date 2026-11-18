// The invite email is written in the language of whoever sends it: the
// person invited has no QuiroFlow language of their own yet, and is almost
// always a colleague who shares the inviter's. It was English only, and a
// Spanish clinic's assistant received "You're invited to join…".
const COPY = {
  en: {
    clinicFallback: 'your clinic',
    subject: (clinic: string) => `You're invited to join ${clinic} on QuiroFlow`,
    heading: (clinic: string) => `You're invited to join ${clinic}`,
    intro: (role: string) => `You've been invited to QuiroFlow as a <strong style="color:#17171C;">${role}</strong>.
            Click below to set up your account and password. Already have a QuiroFlow account with this email? Just sign in.`,
    button: 'Accept invitation',
    paste: 'Or paste this link into your browser:',
    footer: (clinic: string) => `Sent by ${clinic} via QuiroFlow. If you weren't expecting this, you can ignore this email.`,
    roles: {} as Record<string, string>,
  },
  es: {
    clinicFallback: 'tu consulta',
    subject: (clinic: string) => `Te han invitado a unirte a ${clinic} en QuiroFlow`,
    heading: (clinic: string) => `Te han invitado a unirte a ${clinic}`,
    intro: (role: string) => `Te han invitado a QuiroFlow con el rol <strong style="color:#17171C;">${role}</strong>.
            Pulsa el botón para crear tu cuenta y tu contraseña. ¿Ya tienes una cuenta de QuiroFlow con este email? Solo tienes que iniciar sesión.`,
    button: 'Aceptar invitación',
    paste: 'O copia este enlace en tu navegador:',
    footer: (clinic: string) => `Enviado por ${clinic} a través de QuiroFlow. Si no esperabas este email, puedes ignorarlo.`,
    roles: { Owner: 'Propietario', Practitioner: 'Profesional', 'Front Desk': 'Recepción' } as Record<string, string>,
  },
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { supabase, teamMember } = await requireSettingsPermission(event, 'team_admin')

  const body = await readBody<{ inviteId: string }>(event)
  if (!body?.inviteId) {
    throw createError({ statusCode: 400, statusMessage: 'inviteId is required' })
  }

  const { data: invite } = await supabase
    .from('account_invites')
    .select('id, email, role, token, account_id, account_roles(name)')
    .eq('id', body.inviteId)
    .maybeSingle()
  if (!invite || invite.account_id !== teamMember.account_id) {
    throw createError({ statusCode: 404, statusMessage: 'Invite not found' })
  }
  if (!invite.email) {
    throw createError({ statusCode: 400, statusMessage: 'This invite has no email address to send to' })
  }

  if (!config.resendApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'Email sending is not configured (missing RESEND_API_KEY)' })
  }

  const [{ data: account }, { data: sender }] = await Promise.all([
    supabase.from('accounts').select('name').eq('id', invite.account_id).maybeSingle(),
    supabase.from('team_members').select('language_preference').eq('id', teamMember.id).maybeSingle(),
  ])
  const copy = (sender as { language_preference?: string } | null)?.language_preference === 'es' ? COPY.es : COPY.en
  const accountName = escapeHtml(account?.name ?? copy.clinicFallback)

  const origin = getRequestURL(event).origin
  const joinUrl = `${origin}/join?token=${invite.token}`
  const logoUrl = `${origin}/logo/quiroflow-mark.svg`
  const roleName = (invite.account_roles as unknown as { name: string } | null)?.name ?? invite.role
  const roleLabel = escapeHtml(copy.roles[roleName] ?? roleName)

  const html = `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:32px 32px 0;">
          <img src="${logoUrl}" width="32" height="32" alt="QuiroFlow" style="display:block;" />
        </div>
        <div style="padding:24px 32px 32px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#17171C;letter-spacing:-0.01em;">
            ${copy.heading(accountName)}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4A4A57;">
            ${copy.intro(roleLabel)}
          </p>
          <a
            href="${joinUrl}"
            style="display:inline-block;background:#4F46E5;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;"
          >
            ${copy.button}
          </a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#9A9AA6;word-break:break-all;">
            ${copy.paste}<br />
            <a href="${joinUrl}" style="color:#4F46E5;">${joinUrl}</a>
          </p>
        </div>
      </div>
      <p style="max-width:480px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#9A9AA6;text-align:center;">
        ${copy.footer(accountName)}
      </p>
    </div>
  `

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'QuiroFlow <notifications@quiroflow.com>',
      to: invite.email,
      // The subject is plain text, so the clinic's name goes in unescaped.
      subject: copy.subject(account?.name ?? copy.clinicFallback),
      html,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw createError({ statusCode: 502, statusMessage: `Resend error: ${errBody}` })
  }

  // So the pending list can say when it last went out.
  await supabase.from('account_invites').update({ last_sent_at: new Date().toISOString() } as never).eq('id', invite.id)
  return { sent: true }
})
