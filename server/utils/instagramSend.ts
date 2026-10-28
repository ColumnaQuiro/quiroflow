// Sending an Instagram DM as the clinic.
//
// Its own file rather than a branch inside whatsappSend.ts: the two look
// similar from a distance and are not the same API. Instagram uses the
// `recipient`/`message` envelope borrowed from Messenger, has no templates,
// and identifies people by IGSID rather than phone number. Folding them
// together would mean a function whose every line is an if.
//
// It is sent THROUGH THE PAGE: POST /me/messages with the Page token, which
// is Instagram messaging with Facebook Login. /{ig-user-id}/messages is the
// other flavour (Instagram Login, on graph.instagram.com), and Meta answers
// it here with "Unsupported post request. Object with ID ... does not
// support this operation" -- which is what every reply got until 28 Oct
// 2026, the first time one was sent through the platform app.

// Read per call from runtime config (NUXT_META_GRAPH_BASE_URL), never a
// constant: tests point it at a local stub, and a hard-coded host kept every
// send made from here out of reach of the e2e suite.
const graphBase = (): string => useRuntimeConfig().metaGraphBaseUrl

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
  // /me is the Page the token belongs to, so no Page id needs storing: the
  // token saved at connect time already names it.
  const response = await $fetch<{ message_id?: string }>(`${graphBase()}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.instagram_access_token}` },
    body: {
      recipient: { id: recipientId },
      message: { text },
    },
  })
  return response.message_id ?? null
}
