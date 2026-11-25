import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRACTICEHUB_LISTS, PRACTICEHUB_STEP_LISTS, PRACTICEHUB_STEPS, type PracticeHubListPath, type PracticeHubStepKind } from '../../utils/practicehubImport/types'

// A slice loads only the lists PRACTICEHUB_STEP_LISTS names for its step. A
// list a planner reads with practiceHubList and that is not named fails the
// step loudly; one it reads with `snapshot.lists[...]`, because it may be
// absent (2.0's lists), would go missing without a word -- the DNI/NIE from
// '/v3/patients', or the prices from '/billable_items'. So every list each
// planner's source names must be one its steps load.

const PLANNER_FILES: Record<string, PracticeHubStepKind[]> = {
  'patients.ts': ['patients'],
  'appointments.ts': ['appointments'],
  'appointmentTypes.ts': ['appointment_types'],
  'ledger.ts': ['ledger'],
  'bonos.ts': ['bonos'],
  'clinical.ts': ['treatment_notes', 'patient_logs', 'sticky_notes'],
  'carePlans.ts': ['care_plans'],
  'forms.ts': ['custom_form_responses'],
  'exercises.ts': ['exercises'],
  'photos.ts': ['profile_photos'],
  'files.ts': ['file_attachments'],
}

const KNOWN = new Set<string>([...PRACTICEHUB_LISTS, '/files'])

/** The list paths a planner's source names, however it reads them. */
function listsNamedIn(file: string): string[] {
  const source = readFileSync(resolve(__dirname, '../../utils/practicehubImport', file), 'utf8')
  return [...new Set([...source.matchAll(/'(\/[a-z0-9_/]+)'/g)].map((m) => m[1]!).filter((path) => KNOWN.has(path)))]
}

describe('the lists each PracticeHub step loads', () => {
  it('names a list for every step, and only lists the read keeps or a step reads fresh', () => {
    expect(Object.keys(PRACTICEHUB_STEP_LISTS).sort()).toEqual([...PRACTICEHUB_STEPS].sort())
    for (const lists of Object.values(PRACTICEHUB_STEP_LISTS)) {
      for (const path of lists) expect(KNOWN.has(path), path).toBe(true)
    }
  })

  it('covers every planner file', () => {
    expect(Object.values(PLANNER_FILES).flat().sort()).toEqual([...PRACTICEHUB_STEPS].sort())
  })

  for (const [file, steps] of Object.entries(PLANNER_FILES)) {
    it(`loads every list ${file} reads`, () => {
      const loaded = new Set<PracticeHubListPath>(steps.flatMap((step) => PRACTICEHUB_STEP_LISTS[step]))
      const missing = listsNamedIn(file).filter((path) => !loaded.has(path as PracticeHubListPath))
      expect(missing).toEqual([])
    })
  }

  it('keeps the Appointments step off the largest lists of the copy', () => {
    for (const heavy of ['/custom_form_responses', '/patient_logs', '/clinical_notes', '/invoices'] as const) {
      expect(PRACTICEHUB_STEP_LISTS.appointments).not.toContain(heavy)
    }
  })
})
