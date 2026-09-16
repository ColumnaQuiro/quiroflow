// Sending an Instagram DM as the clinic.
//
// Its own file rather than a branch inside whatsappSend.ts: the two look
// similar from a distance and are not the same API. Instagram posts to
// /{ig-user-id}/messages with a `recipient`/`message` envelope borrowed from
// Messenger, has no templates, and identifies people by IGSID rather than
// phone number. Folding them together would mean a function whose every line
// is an if.

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface InstagramAccount {
  instagram_user_id: string
  instagram_access_token: string
}

/**
 * Instagram's messaging window.
 *
 * 24 hours since the person last wrote, the same as WhatsApp's -- and the
 * same consequence, that a reply after it is refused. Kept separate from
 * isWithin24hWindow rather than shared, because they are the same number by
 * coincidence of policy and either platform could change theirs without the
 * other.
 */
export function instagramWindowOpen(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 60 * 60 * 1000
}

/**
 * Sends a text DM. Returns Instagram's message id, which is stored the same
 * way a wamid is so a delivery callback can find the row again.
 */
export async function sendInstagramText(account: InstagramAccount, recipientId: string, text: string): Promise<string | null> {
  const response = await $fetch<{ message_id?: string }>(`${GRAPH_BASE}/${account.instagram_user_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.instagram_access_token}` },
    body: {
      recipient: { id: recipientId },
      message: { text },
    },
  })
  return response.message_id ?? null
}
