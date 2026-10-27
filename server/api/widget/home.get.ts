import { serverSupabaseServiceRole } from '#supabase/server'
import { widgetSnapshotFromRpc, type HomeWidgetRpc } from '~/utils/homeWidget'

// The home-screen widget, fetching its own snapshot while the app is closed
// (iOS: QuiroFlowWidgets.swift; Android: WidgetRefreshWorker.java). It carries
// "Authorization: Bearer <widget token>", which the app got from
// issue_home_widget_token (20261027172713_home_widget_refresh.sql) -- not a
// Supabase session, which the extension must never refresh under the app.
//
// The answer is the very snapshot the app would have written: the same
// get_home_widget, run as the same person, mapped by the same
// widgetSnapshotFromRpc. The widget only lays it out, so nothing about what
// it shows is written twice. Language and privacy mode are the app's
// settings, handed to the widget with the token.
//
//   200  the snapshot
//   204  nothing for this person to show (the widget clears)
//   401  the token is unknown or its session has ended (the widget forgets it)
//   403  a pending second factor, or no longer on the team (the widget hides
//        its figures until the app is opened)
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const token = (getHeader(event, 'authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const q = getQuery(event)
  const accountId = typeof q.account === 'string' ? q.account : ''
  const timeZone = typeof q.tz === 'string' ? q.tz : ''
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Widget token required' })
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw createError({ statusCode: 400, statusMessage: 'account is required' })

  const { data, error } = await serverSupabaseServiceRole(event).rpc('home_widget_for_token' as never, { p_token: token, p_account_id: accountId, p_time_zone: timeZone } as never)
  if (error) {
    if (error.code === '28000') throw createError({ statusCode: 401, statusMessage: 'Widget token revoked' })
    if (error.code === '42501') throw createError({ statusCode: 403, statusMessage: error.message })
    throw createError({ statusCode: 500, statusMessage: 'Widget refresh failed' })
  }

  const snapshot = widgetSnapshotFromRpc(data as unknown as HomeWidgetRpc, { lang: q.lang === 'es' ? 'es' : 'en', privacy: q.privacy === '1' })
  if (!snapshot) {
    setResponseStatus(event, 204)
    return null
  }
  return snapshot
})
