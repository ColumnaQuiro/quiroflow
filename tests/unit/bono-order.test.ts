import { describe, expect, it } from 'vitest'
import { sortBonos } from '../../utils/bonoOrder'

const bono = (id: string, purchased_at: string, used: number, is_closed = false) => ({ id, purchased_at, sessions_total: 10, sessions_used: used, is_closed })

describe('the order of a patient’s bonos', () => {
  it('puts the ones in use first, then the rest, newest first in each', () => {
    const list = [
      bono('old-done', '2026-01-10', 10),
      bono('newer-done', '2026-06-01', 10),
      bono('shared-in-use', '2026-03-01', 4), // a family bono, appended last by the query
      bono('closed-early', '2026-08-01', 2, true),
      bono('own-in-use', '2026-09-01', 1),
    ]
    expect(sortBonos(list).map((b) => b.id)).toEqual(['own-in-use', 'shared-in-use', 'closed-early', 'newer-done', 'old-done'])
  })
})
