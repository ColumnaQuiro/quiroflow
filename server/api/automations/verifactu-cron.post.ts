import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPendingRecords } from '~/server/utils/verifactuSender'

// Sends registros de facturación to the AEAT.
//
// EVERY MINUTE, not every fifteen like the other automation crons, and that
// is not a preference. The AEAT rejects a record whose
// FechaHoraHusoGenRegistro is more than 240 seconds from its own clock --
// error 2004, learned from the service rather than from any document. A
// quarter-hour tick would earn that on nearly every record.
//
// It pairs with the other half of the AEAT's pacing, TiempoEsperaEnvio,
// which has come back as 60 seconds on every response so far: never send
// more often than that, and never leave a record waiting longer than four
// minutes. A one-minute schedule satisfies both.
//
// Doing nothing is the normal outcome. A clinic issues a handful of facturas
// a day, so most ticks find nothing owed and return immediately -- which is
// what makes running this often affordable.
const MAX_ACCOUNTS_PER_TICK = 20

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  // Whether and where each clinic transmits is its own setting (Settings >
  // VeriFactu). The platform key is only what opens each clinic's stored
  // certificate passphrase.
  const secretKey = String(runtimeConfig.verifactuSecretKey ?? '')

  // Accounts with something owed, cheapest question first: with no
  // certificate configured this returns nothing to do and the tick costs one
  // query rather than a round trip per clinic.
  const { data: summary, error: summaryError } = await supabase.rpc('factura_records_awaiting_aeat_summary')

  // Surfaced, never swallowed. `(summary ?? [])` on its own turns a failed
  // query into "nothing owed" and a 200 -- which is indistinguishable from a
  // healthy tick, and is exactly how a cron comes to do nothing for days
  // while every response looks fine. Caught here by a dev server pointed at
  // the wrong database: 126 records were owed and this reported zero.
  if (summaryError) {
    throw createError({
      statusCode: 500,
      statusMessage: `verifactu-cron: could not read what is owed: ${summaryError.message}`,
    })
  }

  const owing = (summary ?? [])
    .filter((row) => Number(row.outstanding) > 0)
    .slice(0, MAX_ACCOUNTS_PER_TICK)

  const results: Record<string, unknown>[] = []

  // One account at a time, deliberately. Cabecera names a single obligado, so
  // each clinic is its own envelope anyway -- and the AEAT's pace is per
  // sender, so firing them in parallel would spend the whole allowance in one
  // tick and get the next one refused.
  for (const row of owing) {
    try {
      const r = await sendPendingRecords(supabase, row.account_id, secretKey)
      results.push({ account: row.account_id, ...r })
    } catch (err) {
      // One clinic's failure must not stop the others. The records stay owed
      // and the next tick tries again; nothing is lost by moving on.
      results.push({
        account: row.account_id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Surfaced on every tick rather than in a separate alert nobody built. A
  // certificate that expires stops transmission, and under VERI*FACTU that
  // failure looks identical to a quiet week -- so the thing that runs every
  // minute is the right place for it to be visible.
  const { data: expiring } = await supabase.rpc('verifactu_certificates_expiring', { p_within_days: 30 })

  // Parked records, on every tick, beside the expiring certificate and for the
  // same reason: under VERI*FACTU a record nobody is sending looks exactly
  // like a record nobody owes. Parking stops the flood -- it must not also
  // stop the reporting, or it becomes a quieter version of the bug it fixes.
  const parked = (summary ?? []).reduce((n, row) => n + Number(row.parked ?? 0), 0)

  // No platform-wide environment to report any more: each clinic's mode is
  // its own, and each result below says what happened for that clinic.
  return {
    accountsOwing: owing.length,
    ...(parked ? { parked } : {}),
    results,
    ...(expiring?.length
      ? { certificatesExpiring: expiring.map((c) => ({ account: c.account_id, daysLeft: c.days_left })) }
      : {}),
  }
})
