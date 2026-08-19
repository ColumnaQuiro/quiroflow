import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  practitioner: 'Practitioner',
  front_desk: 'Front desk',
}

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const config = useRuntimeConfig()

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const body = await readBody<{ inviteId: string }>(event)
  if (!body?.inviteId) {
    throw createError({ statusCode: 400, statusMessage: 'inviteId is required' })
  }

  const { data: invite } = await supabase
    .from('account_invites')
    .select('id, email, role, token, account_id')
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

  const { data: account } = await supabase.from('accounts').select('name').eq('id', invite.account_id).maybeSingle()
  const accountName = account?.name ?? 'your clinic'

  const origin = getRequestURL(event).origin
  const joinUrl = `${origin}/join?token=${invite.token}`
  const logoUrl = `${origin}/logo/quiroflow-mark.svg`
  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role

  const html = `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:32px 32px 0;">
          <img src="${logoUrl}" width="32" height="32" alt="QuiroFlow" style="display:block;" />
        </div>
        <div style="padding:24px 32px 32px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#17171C;letter-spacing:-0.01em;">
            You're invited to join ${accountName}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4A4A57;">
            You've been invited to QuiroFlow as a <strong style="color:#17171C;">${roleLabel}</strong>.
            Click below to set up your account and password.
          </p>
          <a
            href="${joinUrl}"
            style="display:inline-block;background:#4F46E5;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;"
          >
            Accept invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#9A9AA6;word-break:break-all;">
            Or paste this link into your browser:<br />
            <a href="${joinUrl}" style="color:#4F46E5;">${joinUrl}</a>
          </p>
        </div>
      </div>
      <p style="max-width:480px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#9A9AA6;text-align:center;">
        Sent by ${accountName} via QuiroFlow. If you weren't expecting this, you can ignore this email.
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
      from: 'QuiroFlow <onboarding@resend.dev>',
      to: invite.email,
      subject: `You're invited to join ${accountName} on QuiroFlow`,
      html,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw createError({ statusCode: 502, statusMessage: `Resend error: ${errBody}` })
  }

  return { sent: true }
})
