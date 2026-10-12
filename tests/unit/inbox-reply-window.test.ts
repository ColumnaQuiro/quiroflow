import { describe, it, expect } from 'vitest'
import { isClosingMessage, replyWindowLeft, replyWindowPill, REPLY_WINDOW_MS } from '../../utils/inboxReplyWindow'

// A pill on conversations whose 24h WhatsApp window is about to shut with the
// patient's last message unanswered -- but not on the ones where that message
// was a "gracias". The examples are the last messages patients actually left
// in production.

describe('isClosingMessage', () => {
  it.each([
    'Confirmar',
    'gracias',
    'Gracias!',
    'Gracias.',
    'Muchas gracias 😊',
    'vale muchas gracias',
    'Vale,allí estaré. Muchas gracias 😊',
    'Ay, que bien😊. Muchas gracias!!',
    'Perfecto',
    'Sí perfecto',
    'Saludos',
    'Hasta mañana!',
    'Se lo agradezco',
    'No gracias',
    'De momento no. Gracias.',
    'graciasss',
    '👍',
    '❤️',
    'Anular',
  ])('passes over "%s"', (text) => {
    expect(isClosingMessage(text)).toBe(true)
  })

  it.each([
    'Hola',
    'Buenas tardes',
    'Si',
    'No',
    'o 12:30',
    'Más hacia delante',
    'No se descarga',
    'Cancele la cita',
    'Mañana',
    'Hasta las 5',
    'Ya os contesto...',
    'Que os habéis equivocado de número',
    'Gracias, ¿y el jueves?',
    'Vale, gracias. ¿Tenéis hueco el lunes?',
    'Perfecto pero necesito cambiar la hora',
    '',
  ])('keeps "%s"', (text) => {
    expect(isClosingMessage(text)).toBe(false)
  })

  it('keeps a long message even when it is all polite words', () => {
    expect(isClosingMessage('vale vale vale muchas muchas gracias de verdad que si que muy bien')).toBe(false)
  })
})

describe('replyWindowLeft', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()

  it('counts down from the patient\'s last message', () => {
    expect(replyWindowLeft({ direction: 'inbound', channel: 'whatsapp', at: hoursAgo(20), body: '¿Tenéis hueco?' }, now)).toBe(4 * 3600_000)
  })

  it('is nothing once we have answered, on a channel without a window, or after it shut', () => {
    expect(replyWindowLeft({ direction: 'outbound', channel: 'whatsapp', at: hoursAgo(20), body: 'Sí' }, now)).toBeNull()
    expect(replyWindowLeft({ direction: 'inbound', channel: 'in_app', at: hoursAgo(20), body: '¿Hueco?' }, now)).toBeNull()
    expect(replyWindowLeft({ direction: 'inbound', channel: 'whatsapp', at: new Date(now - REPLY_WINDOW_MS - 1).toISOString(), body: '¿Hueco?' }, now)).toBeNull()
  })

  it('applies to Instagram too', () => {
    expect(replyWindowLeft({ direction: 'inbound', channel: 'instagram', at: hoursAgo(23), body: 'Info?' }, now)).toBe(3600_000)
  })

  it('passes over a closing, but never a file or voice note', () => {
    expect(replyWindowLeft({ direction: 'inbound', channel: 'whatsapp', at: hoursAgo(20), body: 'Muchas gracias' }, now)).toBeNull()
    expect(replyWindowLeft({ direction: 'inbound', channel: 'whatsapp', at: hoursAgo(20), body: 'gracias', mediaType: 'image' }, now)).toBe(4 * 3600_000)
  })
})

describe('replyWindowPill', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString()
  const msg = (at: string) => ({ direction: 'inbound', channel: 'whatsapp', at, body: '¿Me podéis llamar?' })

  it('appears only in the last six hours', () => {
    expect(replyWindowPill(msg(minutesAgo(17 * 60)), now)).toBeNull()
    expect(replyWindowPill(msg(minutesAgo(18 * 60)), now)).toEqual({ left: '6 h', urgent: false })
    expect(replyWindowPill(msg(minutesAgo(20 * 60 + 30)), now)).toEqual({ left: '4 h', urgent: false })
  })

  it('turns urgent, in minutes, in the last hour', () => {
    expect(replyWindowPill(msg(minutesAgo(23 * 60 + 20)), now)).toEqual({ left: '40 min', urgent: true })
    expect(replyWindowPill(msg(minutesAgo(23 * 60)), now)).toEqual({ left: '60 min', urgent: true })
  })
})
