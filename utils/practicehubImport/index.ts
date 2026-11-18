import { planAppointments } from './appointments'
import { planAppointmentTypes } from './appointmentTypes'
import { planBonos } from './bonos'
import { planLedger } from './ledger'
import { planPatients } from './patients'
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
}

export function planPracticeHubStep(kind: PracticeHubStepKind, ctx: PracticeHubImportContext, snapshot: PracticeHubSnapshot): Promise<PracticeHubPlan> {
  return PLANNERS[kind](ctx, snapshot)
}
