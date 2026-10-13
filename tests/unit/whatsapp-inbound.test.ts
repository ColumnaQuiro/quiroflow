import { describe, expect, it } from 'vitest'
import { inboundNonTextBody, isReactionBody, skipReaction } from '../../utils/whatsappInbound'
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

  it('never has the receptionist answer a reaction', () => {
    expect(isReactionBody('Ha reaccionado con ❤️')).toBe(true)
    expect(isNoReplyMessage(['Ha reaccionado con 👍'], [])).toBe(true)
    expect(isNoReplyMessage(['Ha reaccionado con 👍', '¿Y el jueves?'], [])).toBe(false)
  })
})
