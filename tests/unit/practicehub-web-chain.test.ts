import { describe, it, expect } from 'vitest'
import { PRACTICEHUB_WEB_STALLED_AFTER_MS, practiceHubWebJobStalled } from '~/server/utils/practicehubWebChain'

// Netlify drops a function's call to its own site after about nine hops, so a
// PracticeHub website job stops every ~45 s and practicehub-web-cron starts it
// again each minute. Too eager and it starts a second chain beside a live one;
// too patient and a job waits minutes for nothing.
describe('when a PracticeHub website job counts as stopped', () => {
  const now = Date.parse('2026-11-26T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('is stopped once nothing has saved for a while and no run holds it', () => {
    expect(practiceHubWebJobStalled({ leaseUntil: 0, updatedAt: ago(PRACTICEHUB_WEB_STALLED_AFTER_MS + 1) }, now)).toBe(true)
  })

  it('is not stopped between two runs of a live chain, which hand over in about a second', () => {
    expect(practiceHubWebJobStalled({ leaseUntil: 0, updatedAt: ago(1_500) }, now)).toBe(false)
  })

  it('is not stopped while a run holds the lease, however long ago it saved', () => {
    expect(practiceHubWebJobStalled({ leaseUntil: now + 10_000, updatedAt: ago(60_000) }, now)).toBe(false)
  })

  it('is caught within the minute the cron ticks at, which ninety seconds was not', () => {
    // A chain cut at second 45 used to wait for a tick after second 135.
    expect(PRACTICEHUB_WEB_STALLED_AFTER_MS).toBeLessThan(60_000)
  })

  it('is stopped when it never saved a time at all', () => {
    expect(practiceHubWebJobStalled({ leaseUntil: 0, updatedAt: null }, now)).toBe(true)
  })
})
