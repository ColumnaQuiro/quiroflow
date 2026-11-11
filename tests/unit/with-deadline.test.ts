import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeadlineError, withDeadline } from '../../utils/withDeadline'

// The PracticeHub files import gives each file one of these so that a request
// Safari froze mid-flight cannot hold up the whole batch forever.
describe('withDeadline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('passes the value through when the work finishes in time', async () => {
    const result = withDeadline(async () => 'stored', 1000)
    await expect(result).resolves.toBe('stored')
  })

  it('passes the work’s own error through unchanged', async () => {
    const result = withDeadline(async () => {
      throw new Error('upload refused')
    }, 1000)
    await expect(result).rejects.toThrow('upload refused')
  })

  it('rejects with a DeadlineError and aborts the signal when the work never settles', async () => {
    let seen: AbortSignal | undefined
    const result = withDeadline((signal) => {
      seen = signal
      return new Promise<never>(() => {})
    }, 90_000)
    const settled = expect(result).rejects.toBeInstanceOf(DeadlineError)
    await vi.advanceTimersByTimeAsync(90_000)
    await settled
    expect(seen?.aborted).toBe(true)
  })

  it('does not abort work that already finished', async () => {
    let seen: AbortSignal | undefined
    await withDeadline(async (signal) => {
      seen = signal
      return 1
    }, 1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(seen?.aborted).toBe(false)
  })
})
