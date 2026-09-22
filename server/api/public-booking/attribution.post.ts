import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Records where a just-completed public booking came from.
//
// Anonymous-safe under the same guard as send-confirmation.post.ts: the
// booking widget has no session, so rather than trusting the appointmentId it
// is sent, this re-derives the appointment from the account slug and requires
// it to be an online booking created in the last ten minutes. An appointment
// id is an unguessable uuid and the window is short, so the worst this can do
// is mislabel a booking someone already knows the id of.
//
// Insert-once, never update: attribution describes the visit that created the
// booking, and a second call for the same appointment is either a retry or an
// attempt to overwrite it. Both should be no-ops.

/** Ad-platform click ids, in the order they are looked for on the landing URL. */
const CLICK_IDS = [
  ['fbclid', 'meta'],
  ['gclid', 'google'],
  // Google's stand-ins for gclid when the click cannot be cookied -- iOS
  // app-to-web, mostly, which is most of a clinic's paid traffic. Same
  // platform, so they resolve to the same source name.
  ['gbraid', 'google'],
  ['wbraid', 'google'],
  ['ttclid', 'tiktok'],
  ['msclkid', 'microsoft'],
] as const

/** Trims to something a text column and a human report can both live with. */
function clean(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

interface Body {
  accountSlug?: string
  appointmentId?: string
  params?: Record<string, unknown>
  referrer?: unknown
  landingPath?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.accountSlug || !body?.appointmentId) {
    throw createError({ statusCode: 400, statusMessage: 'accountSlug and appointmentId are required' })
  }

  const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>

  const utm = {
    utm_source: clean(params.utm_source, 200),
    utm_medium: clean(params.utm_medium, 200),
    utm_campaign: clean(params.utm_campaign, 300),
    utm_content: clean(params.utm_content, 300),
    utm_term: clean(params.utm_term, 300),
  }

  let clickId: string | null = null
  let clickIdSource: string | null = null
  for (const [param, platform] of CLICK_IDS) {
    const value = clean(params[param], 500)
    if (value) {
      clickId = value
      clickIdSource = platform
      break
    }
  }

  const referrer = clean(body.referrer)
  const landingPath = clean(body.landingPath)

  // Nothing worth a row. Deliberately does NOT count landingPath: it is
  // always present (it is just this page's own URL), so including it here
  // would write a row for every direct booking and leave every report
  // filtering them back out. It is stored as context when something else
  // already earned the row.
  if (!clickId && !referrer && Object.values(utm).every((v) => v === null)) {
    return { recorded: false }
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: account } = await supabase.from('accounts').select('id').eq('slug', body.accountSlug).maybeSingle()
  if (!account) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, account_id, created_at, source')
    .eq('id', body.appointmentId)
    .maybeSingle()
  const createdRecently = appt ? Date.now() - new Date(appt.created_at).getTime() < 10 * 60 * 1000 : false
  if (!appt || appt.account_id !== account.id || appt.source !== 'online' || !createdRecently) {
    throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  }

  // ignoreDuplicates leaves the first write standing, which is what makes
  // this insert-once without a read-then-write race.
  const { error } = await supabase
    .from('booking_attribution')
    .upsert(
      {
        appointment_id: appt.id,
        account_id: account.id,
        ...utm,
        click_id: clickId,
        click_id_source: clickIdSource,
        referrer,
        landing_path: landingPath,
      },
      { onConflict: 'appointment_id', ignoreDuplicates: true },
    )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { recorded: true }
})
