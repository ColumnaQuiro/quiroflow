import { describe, it, expect } from 'vitest'
import { judgePressure } from '../../server/utils/importPressure'
import { usageAlerts, type SupabaseUsage } from '../../server/utils/supabaseUsage'

// The Micro's real numbers: 948 MB of RAM, 1 GB of swap.
const TOTAL = 948_191_232
const SWAP = 1_073_737_728
const memory = (availableShare: number, swapUsedShare: number): NonNullable<SupabaseUsage['memory']> => ({
  total_bytes: TOTAL,
  available_bytes: Math.round(TOTAL * availableShare),
  swap_total_bytes: SWAP,
  swap_free_bytes: Math.round(SWAP * (1 - swapUsedShare)),
})

describe('import brake: how hard the database is working', () => {
  it('lets an import run at full speed on a quiet database', () => {
    const p = judgePressure(memory(0.45, 0.3), 60)
    expect(p.level).to.equal('ok')
    expect(p.reasons).to.deep.equal([])
  })

  it('rests between slices on the Micro as it sits idle (25 Nov, 18:15 UTC: 19% free, swap 71%)', () => {
    const p = judgePressure(memory(0.19, 0.71), 70)
    expect(p.level).to.equal('busy')
    expect(p.reasons[0]).to.contain('19% of memory free')
  })

  it('stops when swap is all but gone, whatever else is free', () => {
    const p = judgePressure(memory(0.3, 0.96), 70)
    expect(p.level).to.equal('strained')
    expect(p.reasons).to.deep.equal(['swap 96% used'])
  })

  it('stops on high swap with little memory left -- the line the ops email draws', () => {
    expect(judgePressure(memory(0.15, 0.85), 70).level).to.equal('strained')
    // High swap with plenty free is a peak that passed (23 Nov: 86% with a third free): rest, do not stop.
    expect(judgePressure(memory(0.33, 0.86), 70).level).to.equal('busy')
  })

  it('stops exactly when the ops memory email goes out', () => {
    // 16:30 UTC on 25 Nov the email went out and the import kept writing; 22 minutes later the database stopped.
    for (const [available, swap] of [[0.15, 0.85], [0.3, 0.96], [0.05, 0.99]] as const) {
      const m = memory(available, swap)
      const alerted = usageAlerts({ sampled_at: '', cpu: null, memory: m, disk: null, database_bytes: null, connections: null, storage: null }).some((a) => a.name === 'supabase-memory')
      expect(alerted, `alert at ${available}/${swap}`).to.equal(true)
      expect(judgePressure(m, 70).level, `brake at ${available}/${swap}`).to.equal('strained')
    }
  })

  it('goes by how slowly the database answers when there are no memory figures (local, or the endpoint down)', () => {
    expect(judgePressure(null, 40).level).to.equal('ok')
    expect(judgePressure(null, 900).level).to.equal('busy')
    // 16:40-16:52 on 25 Nov, queries took 5-16 s.
    const slow = judgePressure(null, 5200)
    expect(slow.level).to.equal('strained')
    expect(slow.reasons).to.deep.equal(['a one-row query took 5200 ms'])
  })

  it('treats a database that does not answer as strained, never as fine', () => {
    const p = judgePressure(memory(0.5, 0.1), null)
    expect(p.level).to.equal('strained')
    expect(p.reasons).to.deep.equal(['the database did not answer'])
  })

  it('lets either signal stop it: slow answers with healthy memory, or no memory with fast answers', () => {
    expect(judgePressure(memory(0.5, 0.1), 3000).level).to.equal('strained')
    expect(judgePressure(memory(0.05, 0.97), 40).level).to.equal('strained')
  })
})
