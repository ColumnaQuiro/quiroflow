import { getHeader } from 'h3'
import type { H3Event } from 'h3'

// On its own, with nothing from Nuxt in it, so the unit tests can load it.

/** The address the request came from, as Netlify saw it. */
export function clientIp(event: H3Event): string {
  // Set by Netlify from the connection itself; a client cannot supply it.
  const netlify = getHeader(event, 'x-nf-client-connection-ip')?.trim()
  if (netlify) return netlify
  // The first hop in X-Forwarded-For is the client, the rest are proxies.
  const forwarded = getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return event.node.req.socket?.remoteAddress ?? 'unknown'
}

export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'unknown'
}
