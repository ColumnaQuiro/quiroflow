import { createSign } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'

// Push notification for a new inbound message (WhatsApp or in-app), to
// every team member who can see the Inbox -- the owner (bypasses all
// permission checks, see has_permission()) plus anyone whose role has
// inbox_access. Shared by server/api/whatsapp/webhook.post.ts and
// server/api/patient-messages/send.post.ts rather than duplicated, since
// "who should be notified about a new Inbox message" is one policy
// regardless of which channel it arrived on.
export async function notifyInboxTeamMembers(
  event: H3Event,
  supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>,
  accountId: string,
  senderName: string,
  preview: string,
  data: Record<string, string> = {},
) {
  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, is_owner, account_roles(permissions)')
    .eq('account_id', accountId)
    .not('user_id', 'is', null)
  if (!members) return

  const userIds = members
    .filter((m) => m.is_owner || (m.account_roles as { permissions: Record<string, unknown> } | null)?.permissions?.inbox_access === true)
    .map((m) => m.user_id as string)

  await sendPushToUsers(event, userIds, { title: senderName, body: preview, data })
}

// FCM v1 needs an OAuth access token minted from the Firebase service
// account key, not a static server key (Google retired the legacy server-key
// API). No dependency added for this -- just RS256-signing a JWT assertion
// with Node's built-in crypto and exchanging it at Google's token endpoint,
// the same flow any Google client library does under the hood.
interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

let cachedToken: { value: string; expiresAt: number } | null = null

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  const signature = base64url(signer.sign(account.private_key))
  const assertion = `${header}.${payload}.${signature}`

  const res = await $fetch<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  cachedToken = { value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 }
  return res.access_token
}

/**
 * Pushes a notification to every device registered for the given users.
 * No-ops quietly if FCM isn't configured (fcmServiceAccountJson unset) --
 * same "optional, skip cleanly" convention as WhatsApp delivery tracking.
 */
export async function sendPushToUsers(event: H3Event, userIds: string[], notification: { title: string; body: string; data?: Record<string, string> }) {
  if (userIds.length === 0) return

  const config = useRuntimeConfig()
  const raw = config.fcmServiceAccountJson
  if (!raw) return

  let account: ServiceAccount
  try {
    account = JSON.parse(raw)
  } catch {
    return
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: tokens } = await supabase.from('device_push_tokens').select('fcm_token').in('user_id', userIds)
  if (!tokens || tokens.length === 0) return

  const accessToken = await getAccessToken(account)

  await Promise.all(
    tokens.map((t) =>
      $fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          message: {
            token: t.fcm_token,
            notification: { title: notification.title, body: notification.body },
            data: notification.data,
          },
        },
      }).catch(() => {
        // A dead/expired token failing shouldn't block the others -- it'll
        // just naturally stop being registered next time the app opens.
      }),
    ),
  )
}
