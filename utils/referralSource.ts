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

/**
 * The channel a lead's source names: "Meta Ads · Spring promo" -> "Meta Ads".
 * What goes on a patient's referral source when they came in through a lead
 * -- the campaign stays on the lead, so the origin report gets one row per
 * channel rather than one per campaign. Same rule as lead_source_channel() in
 * 20261021093015_lead_source_on_patient.sql.
 */
export function leadSourceChannel(source: string | null | undefined): string | null {
  const channel = (source ?? '').split('·')[0]?.trim()
  return channel || null
}
