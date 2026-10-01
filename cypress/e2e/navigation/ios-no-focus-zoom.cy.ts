// iOS zooms into any field under 16px when it is focused and never zooms back
// out; nuxt.config.ts adds maximum-scale=1 to the viewport on iOS only, so
// that stops while Android keeps pinch-zoom.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'

function visitAs(path: string, userAgent: string, platform: string, maxTouchPoints = 5) {
  cy.visit(path, {
    onBeforeLoad(win) {
      Object.defineProperty(win.navigator, 'userAgent', { value: userAgent })
      Object.defineProperty(win.navigator, 'platform', { value: platform })
      Object.defineProperty(win.navigator, 'maxTouchPoints', { value: maxTouchPoints })
    },
  })
}
const viewport = () => cy.get('meta[name="viewport"]').invoke('attr', 'content')

describe('No zoom on focus on iOS', () => {
  it('stops an iPhone zooming into a field', () => {
    visitAs('/login', IPHONE, 'iPhone')
    viewport().should('contain', 'maximum-scale=1')
  })

  // iPadOS asks for desktop sites and says "Macintosh"; touch is what gives it away.
  it('stops an iPad zooming into a field too', () => {
    visitAs('/login', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'MacIntel', 5)
    viewport().should('contain', 'maximum-scale=1')
  })

  it('leaves Android and desktop able to zoom', () => {
    visitAs('/login', ANDROID, 'Linux armv8l')
    viewport().should('not.contain', 'maximum-scale')
    visitAs('/login', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'MacIntel', 0)
    viewport().should('not.contain', 'maximum-scale')
  })
})
