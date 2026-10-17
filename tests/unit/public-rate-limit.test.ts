import { describe, expect, it } from 'vitest'
import { clientIp } from '../../server/utils/clientIp'

// The limiter keys on the client address, so which header names it decides
// whether a visitor can dodge the limit by spoofing one, and whether a whole
// office behind one proxy shares a window.
function eventWith(headers: Record<string, string>, remoteAddress?: string) {
  return {
    node: { req: { headers, socket: remoteAddress ? { remoteAddress } : undefined } },
  } as any
}

describe('clientIp', () => {
  it('trusts the address Netlify attaches to the connection first', () => {
    expect(clientIp(eventWith({ 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).to.equal('203.0.113.9')
  })

  it('falls back to the first hop of X-Forwarded-For', () => {
    expect(clientIp(eventWith({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).to.equal('198.51.100.1')
  })

  it('then to the socket, and names the unknown', () => {
    expect(clientIp(eventWith({}, '::1'))).to.equal('::1')
    expect(clientIp(eventWith({}))).to.equal('unknown')
  })
})
