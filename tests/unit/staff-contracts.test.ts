import { describe, expect, it } from 'vitest'
import { contractEnded, currentContract, daysUntilEnd, hoursOverContract, sortContracts } from '../../utils/staffContracts'

const c = (id: string, starts_on: string | null, created_at = '2026-01-01T00:00:00Z', ends_on: string | null = null) => ({ id, starts_on, ends_on, created_at })

describe('staff contracts', () => {
  it('sorts newest start first, undated last, and a correction entered later first on the same day', () => {
    const list = [c('a', '2025-03-01'), c('b', null), c('c', '2026-01-01', '2026-01-02T00:00:00Z'), c('d', '2026-01-01', '2026-01-05T00:00:00Z')]
    expect(sortContracts(list).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b'])
  })

  it('takes the newest contract that has started as the current one', () => {
    const temporal = c('temporal', '2025-03-01', undefined, '2026-02-28')
    const indefinido = c('indefinido', '2026-03-01')
    expect(currentContract([temporal, indefinido], '2026-02-15')?.id).toBe('temporal')
    expect(currentContract([temporal, indefinido], '2026-03-01')?.id).toBe('indefinido')
  })

  it('falls back to a contract that starts later when it is the only one', () => {
    expect(currentContract([c('later', '2027-01-01')], '2026-11-09')?.id).toBe('later')
    expect(currentContract([], '2026-11-09')).toBeNull()
  })

  it('counts the days left to a contract’s end, and knows when it has ended', () => {
    expect(daysUntilEnd({ ends_on: '2026-11-30' }, '2026-11-09')).toBe(21)
    expect(daysUntilEnd({ ends_on: '2026-11-09' }, '2026-11-09')).toBe(0)
    expect(daysUntilEnd({ ends_on: null }, '2026-11-09')).toBeNull()
    expect(daysUntilEnd({ ends_on: '2026-11-08' }, '2026-11-09')).toBeNull()
    expect(contractEnded({ ends_on: '2026-11-08' }, '2026-11-09')).toBe(true)
    expect(contractEnded({ ends_on: '2026-11-09' }, '2026-11-09')).toBe(false)
  })

  it('reports planned minutes above the contracted week only', () => {
    expect(hoursOverContract(42 * 60, 40)).toBe(120)
    expect(hoursOverContract(20 * 60, 20.5)).toBe(0)
    expect(hoursOverContract(45 * 60, null)).toBe(0)
  })
})
