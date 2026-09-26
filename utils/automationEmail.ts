// The envelope an automation email goes out in: the clinic's body inside a
// plain card, and -- for a marketing rule -- an unsubscribe footer and the
// List-Unsubscribe headers mail clients show as their own "Unsubscribe"
// button. Pure, so what a patient receives can be checked without sending.

export interface UnsubscribeLinks {
  /** The page the footer link opens (confirms, then unsubscribes). */
  page: string
  /** Where a mail client POSTs a one-click unsubscribe (RFC 8058). */
  oneClick: string
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The footer under a marketing email. Spanish, like the emails themselves:
 * every clinic on QuiroFlow writes to its patients in Spanish today.
 */
export function unsubscribeFooterHtml(link: string, clinicName?: string | null): string {
  const who = clinicName?.trim() ? escapeHtml(clinicName.trim()) : 'la clínica'
  return `<div style="max-width:560px;margin:16px auto 0;padding:0 8px;font-size:12px;line-height:1.5;color:#8A8A96;text-align:center;">Recibes este email porque aceptaste recibir comunicaciones de ${who}. <a href="${escapeHtml(link)}" style="color:#8A8A96;text-decoration:underline;">Darse de baja</a></div>`
}

/** The whole HTML of an automation email. `bodyHtml` is already merged and styled. */
export function automationEmailHtml(bodyHtml: string, opts: { unsubscribe?: UnsubscribeLinks | null; clinicName?: string | null } = {}): string {
  const footer = opts.unsubscribe ? unsubscribeFooterHtml(opts.unsubscribe.page, opts.clinicName) : ''
  return `
    <div style="background:#F4F4F6;padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;border:1px solid #E4E4EA;overflow:hidden;">
        <div style="padding:24px 32px 32px;font-size:14px;line-height:1.6;color:#4A4A57;">${bodyHtml}</div>
      </div>${footer}
    </div>
  `
}

/** The headers that make Gmail, Apple Mail and Outlook offer their own one-click unsubscribe. */
export function unsubscribeHeaders(links: UnsubscribeLinks | null | undefined): Record<string, string> | undefined {
  if (!links) return undefined
  return {
    'List-Unsubscribe': `<${links.oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
