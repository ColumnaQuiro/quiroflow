// Whether a referral source means "someone sent them", so the patient record
// asks which patient did.
//
// Sources are per-account free text (Settings > Referral sources). Migration
// 0095 seeds "Patient", and the record used to show the "Referred by" picker
// for that exact string only -- so a clinic that also has "Referral" (or
// calls it "Recomendación", "Referido", "Paciente") picked it and found no
// way to say who. Matched without case or accents, on the whole name.
const REFERRAL_SOURCE_NAMES = new Set([
  'patient',
  'paciente',
  'referral',
  'referred',
  'referido',
  'referida',
  'referido por paciente',
  'recommendation',
  'recomendacion',
  'recomendacion de paciente',
  'word of mouth',
  'boca a boca',
])

function normalise(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isPatientReferralSource(name: string | null | undefined): boolean {
  return !!name && REFERRAL_SOURCE_NAMES.has(normalise(name))
}
