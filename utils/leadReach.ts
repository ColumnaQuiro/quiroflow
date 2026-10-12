// Which stages of the acquisition funnel a lead has reached -- the one rule
// the Growth dashboard and the Reports lead funnel both count by, so the two
// cannot disagree.
//
// Mostly leads.furthest_stage, read cumulatively: a lead in Showed was also
// Booked. Corrected by what actually happened to it (growth_lead_progress()
// in the database), because furthest_stage misses two things:
//
//   Contacted -- writing to a lead does not move it out of New. A delivered
//     WhatsApp or a sent email counts.
//   Booked / Showed -- a lead can be Converted by hand without a visit, and
//     reading cumulatively would credit it with one. Those two need an
//     appointment, or an attended one.
//
// So every stage holds the one after it except Converted, which can outnumber
// Showed when someone drags a lead there before a visit.

export const LEAD_FUNNEL_STAGES = ['new', 'contacted', 'qualified', 'booked', 'showed', 'converted'] as const
export type LeadFunnelStage = (typeof LEAD_FUNNEL_STAGES)[number]

/** One row of growth_lead_progress(). */
export interface LeadProgress {
  contacted: boolean
  booked: boolean
  attended: boolean
  appointment_due: boolean
}

export function leadReach(furthestStage: string | null, progress?: LeadProgress | null): Record<LeadFunnelStage, boolean> {
  const rank = LEAD_FUNNEL_STAGES.indexOf((furthestStage ?? '') as LeadFunnelStage)
  const converted = furthestStage === 'converted'
  const showed = furthestStage === 'showed' || Boolean(progress?.attended)
  const booked = showed || furthestStage === 'booked' || Boolean(progress?.booked)
  const qualified = booked || converted || rank >= LEAD_FUNNEL_STAGES.indexOf('qualified')
  const contacted = qualified || rank >= LEAD_FUNNEL_STAGES.indexOf('contacted') || Boolean(progress?.contacted)
  return { new: true, contacted, qualified, booked, showed, converted }
}
