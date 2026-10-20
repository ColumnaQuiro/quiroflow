import { sendResendEmail } from '~~/server/utils/resend'

/**
 * Called once right after a new account is created (pages/onboarding.vue),
 * next to register-clinic-subdomain and for the same reason: that call is
 * the only moment that still knows the attribution the browser carried in,
 * and nobody goes looking for a new sign-up by hand.
 *
 * Deliberately not a database trigger nor a *-cron endpoint. The schema
 * never stores the app URL or the cron secret (see
 * dispatch_receptionist_reply, which takes both as arguments), and a cron
 * endpoint has to be scheduled by hand against production or
 * check:crons-scheduled fails the deploy. A call from the page that just
 * created the account needs neither.
 *
 * The cost: a browser closed between the RPC and this call means no email.
 * The account still exists, so that is a missed notification, not lost data.
 */
// A type rather than an interface, with the index signature, so it is
// assignable to Json when it goes into the jsonb column: an interface
// without one is not, and the named keys below are only the ones we expect
// today -- an ad network that starts sending a new parameter should land
// here too rather than be dropped.
type Attribution = {
  gclid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  referrer?: string
  [key: string]: string | undefined
}

function row(label: string, value: string) {
  return `<tr><td style="padding:4px 14px 4px 0;color:#6B7180;font-size:13px">${label}</td><td style="padding:4px 0;color:#15171E;font-size:13px">${value}</td></tr>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string))
}

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireTeamMember(event)

  const config = useRuntimeConfig()
  const to = config.signupNotifyEmail
  const body = await readBody<{ attribution?: Attribution }>(event).catch(() => ({}) as { attribution?: Attribution })
  const attribution = body?.attribution ?? {}

  // Everything below reads across auth.users and writes a column no clinic
  // setting owns, so it runs as the service role rather than as the caller.
  const service = serviceSupabase()
  if (!service) return { skipped: true }

  const { data: account } = await service
    .from('accounts')
    .select('name, slug')
    .eq('id', teamMember.account_id)
    .maybeSingle()

  const { data: owner } = await service
    .from('team_members')
    .select('full_name, user_id')
    .eq('id', teamMember.id)
    .maybeSingle()

  // Written with the service role on purpose: accounts_guard_settings
  // decides column by column who may update what, and where a sign-up came
  // from is platform bookkeeping rather than a setting the clinic owns.
  if (Object.keys(attribution).length) {
    await service.from('accounts').update({ signup_attribution: attribution }).eq('id', teamMember.account_id)
  }

  // No address configured means no notification, exactly like the Netlify
  // registration next to it: the clinic is created either way.
  if (!to || !config.resendApiKey) return { skipped: true }

  let email = '—'
  if (owner?.user_id) {
    const { data: authUser } = await service.auth.admin.getUserById(owner.user_id)
    email = authUser?.user?.email ?? '—'
  }

  const source = attribution.gclid
    ? `Google Ads · gclid ${attribution.gclid.slice(0, 16)}…`
    : attribution.utm_source
      ? `${attribution.utm_source}${attribution.utm_medium ? ` / ${attribution.utm_medium}` : ''}`
      : attribution.referrer || 'directo o desconocido'

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif">
      <p style="font-size:15px;color:#15171E">Alta nueva en QuiroFlow: <strong>${escapeHtml(account?.name ?? 'cuenta sin nombre')}</strong></p>
      <table style="border-collapse:collapse;margin-top:8px">
        ${row('Cuenta', escapeHtml(account?.name ?? '—'))}
        ${row('Slug', escapeHtml(account?.slug ?? '—'))}
        ${row('Propietario', escapeHtml(owner?.full_name ?? '—'))}
        ${row('Email', escapeHtml(email))}
        ${row('Procedencia', escapeHtml(source))}
        ${attribution.utm_campaign ? row('Campaña', escapeHtml(attribution.utm_campaign)) : ''}
      </table>
    </div>`

  // Best-effort, like the subdomain registration: a notification that fails
  // must never make an onboarding look broken to the person doing it.
  try {
    await sendResendEmail({ to, subject: `Alta nueva: ${account?.name ?? 'cuenta sin nombre'}`, html })
  }
  catch {
    return { sent: false }
  }
  return { sent: true }
})
