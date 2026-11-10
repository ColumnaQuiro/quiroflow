import { describe, it, expect, beforeEach } from 'vitest'
import {
  PRACTICEHUB_READ_TTL_MS,
  forgetPracticeHubReads,
  isPracticeHubReadHeld,
  practiceHubReadsHeld,
  recallPracticeHubRead,
  rememberPracticeHubRead,
} from '../../utils/practicehubReadCache'

// Settings › Import reuses a PracticeHub list read by an earlier step, so the
// next step does not spend a minute re-reading it at one request a second.
describe('PracticeHub lists held between import steps', () => {
  const base = 'https://clinic.practicehub.io'
  const patients = [{ id: 1, patient_number: '202400007' }]

  beforeEach(() => forgetPracticeHubReads())

  it('hands a list read a moment ago back to the next step', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    expect(recallPracticeHubRead(base, '/patients', 2_000)?.rows).toEqual(patients)
    expect(practiceHubReadsHeld(base, 2_000)).toBe(1)
  })

  it('is the same list whether the address ends in a slash or a capital', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    expect(recallPracticeHubRead('https://Clinic.practicehub.io/', '/patients', 2_000)?.rows).toEqual(patients)
  })

  it('hands back a copy, so one step sorting or splicing it does not change what the next one reads', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    const first = recallPracticeHubRead<{ id: number }>(base, '/patients', 2_000)!.rows
    first.splice(0, 1)
    expect(recallPracticeHubRead(base, '/patients', 2_000)?.rows).toEqual(patients)
  })

  it('forgets a list once its time is up, so a record corrected in PracticeHub is read again', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    expect(recallPracticeHubRead(base, '/patients', 1_000 + PRACTICEHUB_READ_TTL_MS)).not.toBeNull()
    expect(recallPracticeHubRead(base, '/patients', 1_001 + PRACTICEHUB_READ_TTL_MS)).toBeNull()
    expect(practiceHubReadsHeld(base, 1_001 + PRACTICEHUB_READ_TTL_MS)).toBe(0)
  })

  it('keeps each list and each clinic apart', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    rememberPracticeHubRead(base, '/invoices', [{ id: 9 }], 1_000)
    expect(recallPracticeHubRead(base, '/invoices', 2_000)?.rows).toEqual([{ id: 9 }])
    expect(recallPracticeHubRead('https://other.practicehub.io', '/patients', 2_000)).toBeNull()
    expect(practiceHubReadsHeld(base, 2_000)).toBe(2)
  })

  it('never holds /files: its download links expire and the Files step re-lists to refresh them', () => {
    expect(isPracticeHubReadHeld('/files')).toBe(false)
    expect(isPracticeHubReadHeld('/patients')).toBe(true)
    rememberPracticeHubRead(base, '/files', [{ id: 3, download_url: 'https://expired' }], 1_000)
    expect(recallPracticeHubRead(base, '/files', 1_001)).toBeNull()
  })

  it('drops everything when told to, so the next read goes to PracticeHub', () => {
    rememberPracticeHubRead(base, '/patients', patients, 1_000)
    forgetPracticeHubReads()
    expect(recallPracticeHubRead(base, '/patients', 1_001)).toBeNull()
  })
})
