import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Off / Test / Live from a date, for the signed-in owner's clinic.
//
// The date is a day, and it means midnight in Madrid: the first factura after
// it opens the production chain. The lock -- no change of date, and no
// leaving 'live', once a production record exists -- is the database's
// (accounts_guard_verifactu), so it holds for every path, this one included.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireOwner(event)
  const body = await readBody<{ mode?: string; productionFrom?: string | null }>(event)

  const mode = body?.mode
  if (mode !== 'off' && mode !== 'test' && mode !== 'live') {
    throw createError({ statusCode: 400, statusMessage: 'mode must be off, test or live' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: current } = await admin.from('accounts').select('verifactu_production_from').eq('id', teamMember.account_id).maybeSingle()

  let productionFrom: string | null = current?.verifactu_production_from ?? null
  if (mode === 'live') {
    const day = body?.productionFrom ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw createError({ statusCode: 400, statusMessage: 'Going live needs a date' })
    }
    const requested = `${day} 00:00:00 Europe/Madrid`
    const unchanged = current?.verifactu_production_from && day === madridDay(current.verifactu_production_from)
    // A day already gone would start the production chain with the next
    // factura rather than on the day chosen, which is not what anyone meant.
    if (!unchanged && day < madridDay(new Date().toISOString())) {
      throw createError({ statusCode: 400, statusMessage: 'The live date cannot be in the past' })
    }
    if (!unchanged) productionFrom = requested
  }

  const { error } = await admin
    .from('accounts')
    .update({ verifactu_mode: mode, verifactu_production_from: productionFrom })
    .eq('id', teamMember.account_id)
  if (error) {
    // The lock speaks for itself; anything else is ours.
    throw createError({ statusCode: error.code === '42501' ? 409 : 500, statusMessage: error.message })
  }
  return { ok: true }
})

function madridDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
