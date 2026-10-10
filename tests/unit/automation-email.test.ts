import { describe, expect, it } from 'vitest'
import { automationEmailHtml, DEFAULT_BOOKING_BUTTON_TEXT } from '../../utils/automationEmail'

describe('the automation email envelope', () => {
  it('is just the message by default', () => {
    const html = automationEmailHtml('<p>Hola</p>')
    expect(html).toContain('<p>Hola</p>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Reserva')
  })

  it('adds the clinic logo above and the booking button below, escaped', () => {
    const html = automationEmailHtml('<p>Hola</p>', {
      clinicName: 'Clínica "Demo"',
      logoUrl: 'https://cdn.example/logo.png',
      button: { text: 'Pide <cita>', url: 'https://app.quiroflow.com/book/demo?a=1&b=2' },
    })
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<p>Hola</p>'))
    expect(html.indexOf('Pide &lt;cita&gt;')).toBeGreaterThan(html.indexOf('<p>Hola</p>'))
    expect(html).toContain('href="https://app.quiroflow.com/book/demo?a=1&amp;b=2"')
    expect(html).toContain('alt="Clínica &quot;Demo&quot;"')
  })

  it('falls back to the default button text', () => {
    expect(automationEmailHtml('', { button: { text: '  ', url: 'https://x' } })).toContain(DEFAULT_BOOKING_BUTTON_TEXT)
  })
})
