import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The importers' way to PracticeHub 2.0's API (server/utils/practicehubV3.ts):
// it sends no CORS headers, and the key must never reach the browser.
//
// Read-only, and narrow on purpose: a GET of one resource, or one record by
// id, with string query parameters. The key can also write, so nothing here
// may build any other request from what the browser sends.
const PATH = /^\/[a-z_]+(\/\d+)?$/

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const body = await readBody<{ path?: string; query?: Record<string, unknown> }>(event)
  const path = body?.path ?? ''
  if (!PATH.test(path)) throw createError({ statusCode: 400, statusMessage: 'path must be /resource or /resource/123' })
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(body?.query ?? {})) {
    if (!/^[a-z_]+$/.test(k) || (typeof v !== 'string' && typeof v !== 'number')) throw createError({ statusCode: 400, statusMessage: `query parameter ${k} is not allowed` })
    query[k] = String(v)
  }
  const conn = await practicehubV3Connection(serverSupabaseServiceRole<Database>(event), teamMember.account_id)
  return practicehubV3Get(conn, path, query)
})
