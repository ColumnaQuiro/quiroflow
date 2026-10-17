import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { clientIp, isLoopback } from './clientIp'

// A brake on the public booking endpoints -- the ones a visitor with no
// account reaches from /book/<slug>: booking, checking a gift code, asking
// for a confirmation. Each is cheap to call and costs the clinic something
// (a calendar slot, a WhatsApp send, a Stripe session), and until this
// existed nothing limited how often one address could call them. A gift
// code in particular is short enough to guess by trying.
//
// Counted per endpoint and client address in public_rate_limits
// (20261017_public_booking_rate_limits.sql), through a service-role RPC.
// The limit is a ceiling on abuse, not a budget for use: a family booking
// four appointments from one phone stays far inside it.
//
// Fails open. If the counter itself cannot be reached, the request goes
// through -- a booking refused because a bookkeeping table was down would be
// the worse outcome, and the error is logged for someone to see.

export interface PublicRateLimit {
  /** Names the endpoint, so one limit does not spend another's. */
  scope: string
  limit: number
  windowSeconds: number
}

/**
 * Counts this request against `scope` for its client address and refuses it
 * with 429 once the window's limit is passed. The refusal carries a message
 * for the patient in `data.message`, the shape the booking page already
 * reads for the booking function's own refusals.
 */
export async function throttlePublic(event: H3Event, { scope, limit, windowSeconds }: PublicRateLimit): Promise<void> {
  const ip = clientIp(event)
  // Local development and the e2e suite come from the loopback address with
  // no proxy in front, and run a whole shard of bookings from it in minutes.
  // Netlify always supplies a real address, so this never applies there.
  if (isLoopback(ip)) return

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await supabase.rpc('consume_public_rate_limit' as never, {
    p_key: `${scope}:${ip}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  } as never)
  if (error) {
    console.error(`[public-rate-limit] ${scope}: limiter unavailable, allowing request:`, error.message)
    return
  }
  const row = (data as unknown as { allowed: boolean; retry_after_seconds: number }[] | null)?.[0]
  if (!row || row.allowed) return

  setHeader(event, 'Retry-After', Math.max(1, row.retry_after_seconds))
  throw createError({
    statusCode: 429,
    statusMessage: 'Too many requests',
    data: { message: 'Demasiados intentos seguidos desde esta conexión. Espera unos minutos e inténtalo de nuevo.' },
  })
}
