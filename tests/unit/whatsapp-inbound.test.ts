import { describe, expect, it } from 'vitest'
import { adFromReferral, inboundNonTextBody, isReactionBody, reactionEmoji, reactionOn, skipReaction } from '../../utils/whatsappInbound'
import { cameFromAd } from '../../utils/receptionistLeadOrigin'
import { isNoReplyMessage } from '../../utils/receptionistAutoReply'

// A 👍 on the receptionist's "your visit is moved" arrived as an empty bubble.
describe('WhatsApp messages that are not text', () => {
  it('shows a reaction, and drops one being taken back', () => {
    expect(inboundNonTextBody({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } })).toBe('Ha reaccionado con 👍')
    expect(skipReaction({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '' } })).toBe(true)
    expect(skipReaction({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } })).toBe(false)
  })

  it('shows a location and a shared contact', () => {
    expect(inboundNonTextBody({ type: 'location', location: { latitude: 39.47, longitude: -0.37, name: 'Clínica Demo', address: 'Calle Mayor 1' } }))
      .toBe('📍 Ubicación: Clínica Demo, Calle Mayor 1 https://maps.google.com/?q=39.47,-0.37')
    expect(inboundNonTextBody({ type: 'contacts', contacts: [{ name: { formatted_name: 'Ana García' }, phones: [{ phone: '+34 600 000 000' }] }] }))
      .toBe('👤 Contacto: Ana García +34 600 000 000')
  })

  it('says so for a type the API does not pass on, and leaves text and media alone', () => {
    expect(inboundNonTextBody({ type: 'unsupported' })).toContain('míralo en el teléfono')
    for (const type of ['text', 'button', 'interactive', 'image', 'sticker']) expect(inboundNonTextBody({ type })).toBeNull()
  })

  // Shown on the message it reacts to (whatsapp_messages.contact_reaction),
  // so the webhook needs which message, and whether it is being taken back.
  it('says which message a reaction is about, and when it is being taken back', () => {
    expect(reactionOn({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } })).toEqual({ messageId: 'wamid.x', emoji: '👍' })
    expect(reactionOn({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '' } })).toEqual({ messageId: 'wamid.x', emoji: null })
    expect(reactionOn({ type: 'reaction', reaction: { emoji: '👍' } })).toBeNull()
    expect(reactionOn({ type: 'text' })).toBeNull()
  })

  it('reads the emoji back out of a reaction stored as a line', () => {
    expect(reactionEmoji('Ha reaccionado con ❤️')).toBe('❤️')
    expect(reactionEmoji('Gracias 👍')).toBeNull()
    expect(reactionEmoji(null)).toBeNull()
  })

  it('never has the receptionist answer a reaction', () => {
    expect(isReactionBody('Ha reaccionado con ❤️')).toBe(true)
    expect(isNoReplyMessage(['Ha reaccionado con 👍'], [])).toBe(true)
    expect(isNoReplyMessage(['Ha reaccionado con 👍', '¿Y el jueves?'], [])).toBe(false)
  })
})

// The ad's 50 € first visit was quoted as the regular 70 € because the lead
// only became the ad's when its form arrived, half an hour after the reply.
describe('A WhatsApp message sent from an ad', () => {
  it('names the ad by its headline, or its id', () => {
    expect(adFromReferral({ source_type: 'ad', source_id: '1202', headline: '  -30% En tu\nPrimera Visita ' })).toBe('-30% En tu Primera Visita')
    expect(adFromReferral({ source_type: 'ad', source_id: '1202' })).toBe('1202')
    expect(adFromReferral({ source_type: 'ad' })).toBe('Meta Ads')
  })

  it('is not an ad when it came from a post, or from nowhere', () => {
    expect(adFromReferral({ source_type: 'post', source_id: '9', headline: 'Un post' })).toBeNull()
    expect(adFromReferral(undefined)).toBeNull()
    expect(adFromReferral(null)).toBeNull()
  })

  it('is what makes the receptionist read them as from the ad', () => {
    const ad = adFromReferral({ source_type: 'ad', headline: '-30% En tu Primera Visita' })
    expect(cameFromAd({ channel: 'whatsapp', source: 'Meta Ads · WhatsApp', externalSource: 'whatsapp', campaign: null, ad })).toBe(true)
    expect(cameFromAd({ channel: 'whatsapp', source: 'WhatsApp', externalSource: 'whatsapp', campaign: null, ad: null })).toBe(false)
  })
})
