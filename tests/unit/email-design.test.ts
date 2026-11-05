import { describe, it, expect } from 'vitest'
import {
  asEmailDesign,
  emailDesignHasContent,
  emailDesignHtml,
  emailDesignTokens,
  legacyEmailDesign,
  linkHref,
  resolveEmailTheme,
  safeUrl,
  starterEmailDesign,
  type EmailDesign,
} from '../../utils/emailDesign'

// The block email compiler: what the builder shows, "Send test" sends and a
// patient receives is this one function's output, so its shape is pinned
// here -- the parts mail clients are fussy about, and the parts that keep
// patient data and staff input from becoming markup.

const design = (blocks: EmailDesign['blocks'], extra: Partial<EmailDesign> = {}): EmailDesign => ({ version: 1, blocks, ...extra })

describe('emailDesignHtml', () => {
  it('is a presentation table 600px wide with every style inline', () => {
    const html = emailDesignHtml(starterEmailDesign('es'), { clinicName: 'Clínica Demo' })
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('role="presentation" class="qf-card" width="600"')
    expect(html).toContain('<meta name="color-scheme" content="light">')
    // No class does styling on its own except the phone overrides.
    expect(html).not.toMatch(/class="(?!qf-)/)
  })

  it('leaves merge fields for the send to fill, including in a button link', () => {
    const html = emailDesignHtml(starterEmailDesign('es'))
    expect(html).toContain('Hola {{first_name}}')
    expect(html).toContain('href="{{booking_link}}"')
  })

  it('gives the button a VML twin for Outlook, in the brand colour', () => {
    const html = emailDesignHtml(design([{ id: 'b', type: 'button', text: 'Reservar', link: { kind: 'booking' }, align: 'center' }]), { branding: { brandColor: '#0F766E' } })
    expect(html).toContain('<!--[if mso]><v:roundrect')
    expect(html).toContain('fillcolor="#0F766E"')
    expect(html).toContain('background:#0F766E')
  })

  it('stacks columns without needing the media query', () => {
    const html = emailDesignHtml(design([{ id: 'c', type: 'columns', columns: [{ image: null, html: '<p>A</p>' }, { image: null, html: '<p>B</p>' }] }]))
    expect(html.match(/class="qf-col" style="display:inline-block;width:100%;max-width:260px/g)).toHaveLength(2)
  })

  it('escapes what staff type into headings and button labels', () => {
    const html = emailDesignHtml(design([
      { id: 'h', type: 'heading', text: '<script>x</script>', align: 'left' },
      { id: 'b', type: 'button', text: '"><img src=x>', link: { kind: 'url', url: 'https://ejemplo.com' }, align: 'left' },
    ]))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"><img src=x>')
  })

  it('never links anywhere but the web, mail or phone', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('data:text/html,x')).toBe('')
    expect(safeUrl('columnaquiro.com/oferta')).toBe('https://columnaquiro.com/oferta')
    expect(safeUrl('hola@ejemplo.com')).toBe('mailto:hola@ejemplo.com')
    expect(linkHref({ kind: 'review' })).toBe('{{google_review_link}}')
  })

  it('shows the clinic name when there is no logo, and the logo when there is', () => {
    const block = design([{ id: 'h', type: 'header', align: 'center' }])
    expect(emailDesignHtml(block, { clinicName: 'Clínica Demo' })).toContain('>Clínica Demo</span>')
    expect(emailDesignHtml(block, { clinicName: 'Clínica Demo', logoUrl: 'https://x.test/l.png' })).toContain('<img src="https://x.test/l.png" alt="Clínica Demo"')
  })

  it('adds the unsubscribe footer only when given one, outside the card', () => {
    const d = starterEmailDesign('es')
    expect(emailDesignHtml(d)).not.toContain('Darse de baja')
    const html = emailDesignHtml(d, { unsubscribe: { page: 'https://x.test/u', oneClick: 'https://x.test/o' }, clinicName: 'Clínica Demo' })
    // After the card closes, so it reads as the email's small print, not its content.
    expect(html.indexOf('Darse de baja')).toBeGreaterThan(html.indexOf('</table>\n<!--[if mso]></td></tr></table><![endif]-->'))
  })

  it('hides the preheader from the body but keeps it in the document', () => {
    const html = emailDesignHtml(design([], { preheader: 'Han pasado unos meses' }))
    expect(html).toMatch(/<div style="display:none;[^"]*">Han pasado unos meses/)
  })
})

describe('the theme', () => {
  it('takes the clinic branding, then the email, and refuses anything that is not a colour', () => {
    const theme = resolveEmailTheme({ brandColor: '#0F766E', font: 'georgia' }, { brandColor: 'red;background:url(x)' as string, buttonTextColor: '#111111' })
    expect(theme.brandColor).toBe('#0F766E')
    expect(theme.buttonTextColor).toBe('#111111')
    expect(theme.font).toBe('georgia')
  })
})

describe('the plain editor, as blocks', () => {
  it('carries the body over untouched, with the logo and the button it had', () => {
    const d = legacyEmailDesign({ body: '<p>Hola {{first_name}}</p>', include_logo: true, booking_button: true, booking_button_text: 'Pide tu cita' })
    expect(d.blocks.map((b) => b.type)).toEqual(['header', 'text', 'button'])
    expect(d.blocks[1]).toMatchObject({ html: '<p>Hola {{first_name}}</p>' })
    expect(d.blocks[2]).toMatchObject({ text: 'Pide tu cita', link: { kind: 'booking' } })
  })

  it('leaves out what the email did not have', () => {
    expect(legacyEmailDesign({ body: '<p>x</p>' }).blocks.map((b) => b.type)).toEqual(['text'])
  })
})

describe('reading a design', () => {
  it('knows which merge fields it uses, wherever they are', () => {
    const d = design([
      { id: 't', type: 'text', html: '<p>{{first_name}}</p>' },
      { id: 'b', type: 'button', text: 'Valora', link: { kind: 'review' }, align: 'center' },
    ], { preheader: '{{clinic_name}}' })
    expect([...emailDesignTokens(d)].sort()).toEqual(['clinic_name', 'first_name', 'google_review_link'])
  })

  it('says an email of empty blocks has nothing in it', () => {
    expect(emailDesignHasContent(design([{ id: 't', type: 'text', html: '<p>&nbsp;</p>' }, { id: 'd', type: 'divider' }]))).toBe(false)
    expect(emailDesignHasContent(starterEmailDesign('es'))).toBe(true)
  })

  it('refuses a stored value that is not a design', () => {
    expect(asEmailDesign(null)).toBeNull()
    expect(asEmailDesign({ version: 2, blocks: [] })).toBeNull()
    expect(asEmailDesign({ version: 1, blocks: [{ id: 'x', type: 'iframe' }] })).toBeNull()
    expect(asEmailDesign({ version: 1, blocks: [] })).toEqual({ version: 1, blocks: [] })
  })
})
