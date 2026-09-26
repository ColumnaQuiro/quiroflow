import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { RUN_COLUMNS } from '~/server/utils/leadSequences'
import { advanceRun, enrolDueSegments } from '~/server/utils/automationEngine'

// Advances every automation run that is due -- a lead's drip, and since the
// automation engine a patient's run too: a delay that has elapsed, a
// wait_until whose deadline has passed (it takes its timeout path), a step
// deferred by quiet hours or a failed step's retry. It also enrols the
// patients of any scheduled segment rule that has come due. One cron for all
// of it, deliberately: this one is already scheduled in production, and a new
// *-cron endpoint would need a hand-made pg_cron job before it did anything.
//
// Same shape and the same 15-minute tick as the other automation crons, but
// it reads a state row rather than recomputing "is anything due" from
// appointments -- a sequence knows where it got to, which is the whole point
// of the runs table.
//
// The batch cap exists because a clinic that suddenly imports a few hundred
// leads should not turn one tick into a request that outlives the function.
// Whatever is left is simply still due at the next tick.
const MAX_PER_TICK = 100
const CONCURRENCY = 5

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin

  // Enrolment first, so the runs it creates are due in this same tick (up to
  // the cap). A failure here must not stop runs already in flight.
  let enrolled = 0
  try {
    enrolled = await enrolDueSegments(supabase, origin)
  } catch (err) {
    console.error('[lead-sequence-cron] segment enrolment failed:', (err as Error)?.message ?? err)
  }

  const { data: due } = await supabase
    .from('automation_sequence_runs')
    .select(RUN_COLUMNS)
    .eq('status', 'running')
    .lte('resume_at', new Date().toISOString())
    .order('resume_at')
    .limit(MAX_PER_TICK)

  const runs = due ?? []
  let advanced = 0

  for (let i = 0; i < runs.length; i += CONCURRENCY) {
    await Promise.all(
      runs.slice(i, i + CONCURRENCY).map(async (run) => {
        try {
          await advanceRun(supabase, run as never, origin)
          advanced += 1
        } catch (err) {
          // One lead's sequence failing must not stop the rest of the tick.
          // The run stays 'running' and due, so the next tick retries it. A
          // step that fails is handled inside advanceSequenceRun (counted,
          // retried, then parked as 'failed'); reaching here means something
          // around it threw, which is rarer and only in the server log.
          console.error('[lead-sequence-cron] run failed:', (run as { id: string }).id, (err as Error)?.message ?? err)
        }
      }),
    )
  }

  return { due: runs.length, advanced, ...(enrolled ? { enrolled } : {}) }
})
