// What the Inbox shows for an inbound WhatsApp message that is not text or
// media.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

export interface InboundNonTextMessage {
  type: string
  reaction?: { message_id?: string; emoji?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[]
}

/** How a stored reaction starts: what isReactionBody looks for. */
export const REACTION_PREFIX = 'Ha reaccionado con '

/** Whether a stored message is a reaction (see inboundNonTextBody). */
export function isReactionBody(text: string | null | undefined): boolean {
  return Boolean(text?.startsWith(REACTION_PREFIX))
}

/**
 * The line stored for a reaction, a location, a shared contact or a type
 * WhatsApp does not hand to the Cloud API. The webhook read only text,
 * buttons and media, so all of these arrived as an empty bubble: a patient
 * reacting 👍 to the receptionist's "your visit is moved" looked like a
 * message nobody could read.
 *
 * Null for a type that is handled elsewhere (text, buttons, media). A
 * reaction with no emoji is one being taken back, and is not a message at all
 * -- skipReaction says so.
 */
export function inboundNonTextBody(msg: InboundNonTextMessage): string | null {
  switch (msg.type) {
    case 'reaction':
      return msg.reaction?.emoji ? `${REACTION_PREFIX}${msg.reaction.emoji}` : null
    case 'location': {
      const loc = msg.location
      if (!loc) return '📍 Ubicación'
      const label = [loc.name, loc.address].filter((s) => s?.trim()).join(', ')
      const map = typeof loc.latitude === 'number' && typeof loc.longitude === 'number' ? ` https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : ''
      return `📍 Ubicación${label ? `: ${label}` : ''}${map}`
    }
    case 'contacts': {
      const people = (msg.contacts ?? []).map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(' ')).filter(Boolean)
      return `👤 Contacto${people.length ? `: ${people.join('; ')}` : ''}`
    }
    case 'text':
    case 'button':
    case 'interactive':
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      return null
    default:
      // 'unsupported' (a poll, a view-once photo, an edited message...) and
      // anything Meta adds later.
      return '(Mensaje que WhatsApp no permite mostrar aquí: míralo en el teléfono)'
  }
}

/**
 * What a reaction is about: the wamid of the message it reacts to, and the
 * emoji -- null when the reaction is being taken back. Null for anything
 * that is not a reaction, or one that names no message.
 */
export function reactionOn(msg: InboundNonTextMessage): { messageId: string; emoji: string | null } | null {
  if (msg.type !== 'reaction' || !msg.reaction?.message_id) return null
  return { messageId: msg.reaction.message_id, emoji: msg.reaction.emoji || null }
}

/** The emoji of a stored reaction line ("Ha reaccionado con 👍"), for drawing it small. */
export function reactionEmoji(text: string | null | undefined): string | null {
  return isReactionBody(text) ? text!.slice(REACTION_PREFIX.length).trim() || null : null
}

/** A reaction being removed: nothing to show, and nothing to answer. */
export function skipReaction(msg: InboundNonTextMessage): boolean {
  return msg.type === 'reaction' && !msg.reaction?.emoji
}
