import { describe, expect, it } from 'vitest'
import { writePlan } from '../../server/utils/importJobs'

// How a step's plan carries on across slices: when it is finished, and when
// it is given up as making no progress.

const t = (en: string) => en
const plan = (res: { written: number; progressed?: number; more?: boolean }) => ({
  total: 1,
  warnings: [],
  apply: async () => ({ errors: [], ...res }),
})

describe('writing a step over slices', () => {
  it('a step that left a large file part-copied runs again next slice, though it had time left', async () => {
    let progress = {}
    for (let i = 0; i < 5; i++) {
      const out = await writePlan(plan({ written: 0, progressed: 6 * 1024 * 1024, more: true }), 'file_attachments', progress, Date.now() + 35_000, () => {}, t)
      // Copying pieces is progress: never stopped as stalled, however many slices one file takes.
      expect(out.result).toBeUndefined()
      progress = out.progress
    }
    const last = await writePlan(plan({ written: 1 }), 'file_attachments', progress, Date.now() + 35_000, () => {}, t)
    expect(last.result).toMatchObject({ step: 'file_attachments', written: 1, errors: [] })
  })

  it('is stopped after three slices that left something for later and moved nothing', async () => {
    let progress = {}
    let out
    for (let i = 0; i < 3; i++) {
      out = await writePlan(plan({ written: 0, more: true }), 'file_attachments', progress, Date.now() + 35_000, () => {}, t)
      progress = out.progress
    }
    expect(out!.result?.errors[0]).toMatch(/made no progress/)
  })
})
