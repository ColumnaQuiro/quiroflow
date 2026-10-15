import { describe, expect, it } from 'vitest'
import { productMarginPct, stockStatus } from '../../utils/products'

describe('products', () => {
  it('reads the stock state', () => {
    expect(stockStatus(null, 5)).toBe('untracked')
    expect(stockStatus(0, 5)).toBe('out')
    expect(stockStatus(3, 6)).toBe('low')
    expect(stockStatus(6, 6)).toBe('low')
    expect(stockStatus(14, 5)).toBe('ok')
    expect(stockStatus(2, null)).toBe('ok')
  })

  it('takes the margin on the price before IVA', () => {
    // 36,30 € with 21 % IVA is 30,00 € net; a unit costing 18,00 € leaves 40 %.
    expect(productMarginPct(3630, 21, 1800)).toBe(40)
    expect(productMarginPct(1100, 10, 500)).toBe(50)
    expect(productMarginPct(3630, 21, null)).toBeNull()
  })
})
