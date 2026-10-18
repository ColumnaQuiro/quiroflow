// The QR on a bono's wallet pass (server/utils/walletPkpass.ts and
// googleWalletPass.ts) is a link to the patient's record:
// https://app.quiroflow.com/patients/<patient id>. The staff app reads it two
// ways -- its own Scan button, and the system camera opening the app on that
// link -- and both turn it back into the patient here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The patient a pass's QR names, or null for anything else: another site,
 * another QuiroFlow page, a QR that is not a link at all. Only quiroflow.com
 * hosts, so a QR pointing somewhere else can never steer the app.
 */
export function patientIdFromPassLink(text: string | null | undefined): string | null {
  let url: URL
  try {
    url = new URL((text ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'quiroflow.com' && !url.hostname.endsWith('.quiroflow.com')) return null
  const m = /^\/patients\/([^/]+)\/?$/.exec(url.pathname)
  if (!m || !UUID.test(m[1]!)) return null
  return m[1]!.toLowerCase()
}
