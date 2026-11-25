import { planAppointments } from './appointments'
import { planAppointmentTypes } from './appointmentTypes'
import { planBonos } from './bonos'
import { planCarePlans } from './carePlans'
import { planPatientLogs, planStickyNotes, planTreatmentNotes } from './clinical'
import { planFileAttachments } from './files'
import { planExercises } from './exercises'
import { planCustomFormResponses } from './forms'
import { planLedger } from './ledger'
import { planPatients } from './patients'
import { planPracticeHubProfilePhotos } from './photos'
import type { PracticeHubImportContext, PracticeHubPlan, PracticeHubSnapshot, PracticeHubStepKind, PracticeHubStepPlanner } from './types'

export * from './types'

// What each PracticeHub import step will write, worked out from the copy the
// read made (server/utils/practicehubSnapshotStore.ts) against what is
// already here, and written on Apply. The server job runs these in slices
// (server/utils/importJobs.ts); /api/import/practicehub-preview plans with
// the same code and never applies.
const PLANNERS: Record<PracticeHubStepKind, PracticeHubStepPlanner> = {
  patients: planPatients,
  appointments: planAppointments,
  appointment_types: planAppointmentTypes,
  ledger: planLedger,
  bonos: planBonos,
  treatment_notes: planTreatmentNotes,
  care_plans: planCarePlans,
  patient_logs: planPatientLogs,
  sticky_notes: planStickyNotes,
  custom_form_responses: planCustomFormResponses,
  exercises: planExercises,
  profile_photos: planPracticeHubProfilePhotos,
  file_attachments: planFileAttachments,
}

export function planPracticeHubStep(kind: PracticeHubStepKind, ctx: PracticeHubImportContext, snapshot: PracticeHubSnapshot): Promise<PracticeHubPlan> {
  return PLANNERS[kind](ctx, snapshot)
}
