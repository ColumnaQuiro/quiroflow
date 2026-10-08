import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

export type PatientAccessKind = Database['public']['Functions']['log_patient_access']['Args']['p_kind']

// The server's half of the patient access log (20261008070424_audit_trail.sql):
// a staff PDF of a patient's invoice, factura or statement leaves the building
// the same way a file download does.
//
// Called with the guard's own client, so log_patient_access sees the caller's
// auth.uid() and records them exactly as it does a browser call. Never throws:
// the document is what the person asked for, and a log row failing to write
// is not a reason to refuse it.
export async function logPatientAccess(
  supabase: SupabaseClient<Database>,
  accountId: string,
  kind: PatientAccessKind,
  patientId: string | null,
  detail?: Record<string, unknown>,
) {
  const { error } = await supabase.rpc('log_patient_access', {
    p_account_id: accountId,
    p_kind: kind,
    p_patient_id: patientId ?? undefined,
    p_detail: (detail ?? undefined) as Database['public']['Functions']['log_patient_access']['Args']['p_detail'],
  })
  if (error) console.error('[access-log]', kind, error.message)
}
