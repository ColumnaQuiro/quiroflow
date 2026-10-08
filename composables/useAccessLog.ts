import type { Json } from '~/types/database.types'

export type AccessKind = 'record_opened' | 'file_viewed' | 'file_downloaded' | 'export'

// Reports a look at patient data to the access log an owner reads under
// Settings -> Activity log (20261008070424_audit_trail.sql). A trigger can
// see a write but never a read, so the app says when it shows a patient's
// record, opens one of their files, or exports patients.
//
// Fire-and-forget: nobody should wait on, or be refused, what they asked to
// see because a log row did not write. The database collapses repeat opens
// of the same record within 15 minutes, so callers need not.
export function useAccessLog() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  return function logAccess(kind: AccessKind, patientId?: string | null, detail?: Record<string, Json>) {
    if (!store.accountId) return
    supabase
      .rpc('log_patient_access', {
        p_account_id: store.accountId,
        p_kind: kind,
        p_patient_id: patientId ?? undefined,
        p_detail: detail,
      })
      .then(({ error }) => {
        if (error) console.warn('[access-log]', kind, error.message)
      })
  }
}
