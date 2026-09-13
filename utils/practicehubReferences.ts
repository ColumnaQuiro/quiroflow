// Finding patients stored under the wrong PracticeHub reference.
//
// PracticeHub's CSV export puts a patient's CUSTOM reference -- a DNI, an NIE,
// a passport -- in the "Patient Number" column whenever they have one, and the
// Patients importer reads that column. So those patients arrive keyed by their
// ID document instead of their patient number.
//
// Nothing errors. The patient imports fine. Then every other importer, which
// matches on external_reference, skips them as "no matching patient" -- their
// invoices, payments and bonos quietly never arrive. On Columnaquiro that was
// 44 patients and it went unnoticed for a month, surfacing only as balances
// that would not reconcile.
//
// Two of those 44 stored an all-digit document, indistinguishable from a
// patient number by shape. That is why this compares against PracticeHub's own
// custom_reference rather than trying to recognise a DNI: the source system
// already knows which value it is, and guessing from the format misses the
// ones that matter.
export interface PracticeHubPatientRef {
  patient_number: string | null
  custom_reference?: string | null
}

export interface StoredPatientRef {
  external_reference: string | null
  first_name: string
  last_name: string | null
}

export interface MisreferencedPatient {
  name: string
  stored: string
  shouldBe: string
}

export function findMisreferencedPatients(
  phPatients: PracticeHubPatientRef[],
  storedPatients: StoredPatientRef[],
): MisreferencedPatient[] {
  const patientNumbers = new Set(
    phPatients.map((p) => String(p.patient_number ?? '').trim()).filter(Boolean),
  )

  const byCustomRef = new Map<string, string>()
  for (const p of phPatients) {
    const custom = String(p.custom_reference ?? '').trim()
    const number = String(p.patient_number ?? '').trim()
    if (custom && number) byCustomRef.set(custom, number)
  }

  const found: MisreferencedPatient[] = []
  for (const row of storedPatients) {
    const stored = String(row.external_reference ?? '').trim()
    if (!stored) continue
    // A reference PracticeHub recognises as a patient number is fine, whatever
    // it looks like.
    if (patientNumbers.has(stored)) continue

    // Only reported when PracticeHub itself says this value is that patient's
    // custom reference. A stored reference matching nothing at all is a
    // different problem -- a deleted patient, a hand-typed value -- and saying
    // "this should be X" without knowing X would be a guess.
    const shouldBe = byCustomRef.get(stored)
    if (!shouldBe) continue

    found.push({
      name: `${row.first_name} ${row.last_name ?? ''}`.trim(),
      stored,
      shouldBe,
    })
  }
  return found
}
