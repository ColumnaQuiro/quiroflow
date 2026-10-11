import { noShowRiskByPatient, type NoShowHistoryRow, type NoShowRisk } from '../utils/noShowRisk'

// Each patient's no-show risk (utils/noShowRisk.ts), for the handful on a
// screen: one query for the visits they have had in the last year. RLS
// decides what that sees, as for every other read of appointments -- an
// 'own'-scope practitioner reads their own patients' history.
export function useNoShowRisk() {
  const supabase = useSupabaseClient()

  async function riskFor(patientIds: string[]): Promise<Map<string, NoShowRisk>> {
    const ids = [...new Set(patientIds.filter(Boolean))]
    const now = new Date()
    if (ids.length === 0) return new Map()
    const { data } = await supabase
      .from('appointments')
      .select('patient_id, starts_at, status')
      .in('patient_id', ids)
      .in('status', ['completed', 'no_show'])
      .is('deleted_at', null)
      .gte('starts_at', new Date(now.getTime() - 365 * 86_400_000).toISOString())
      .lt('starts_at', now.toISOString())
      .limit(5000)
    return noShowRiskByPatient((data as NoShowHistoryRow[] | null) ?? [], ids, now)
  }

  return { riskFor }
}
