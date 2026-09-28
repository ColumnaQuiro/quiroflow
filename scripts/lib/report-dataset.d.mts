import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReportDatasetScale {
  patients: number
  appointments: number
  invoices: number
  payments: number
  purchases: number
  messages: number
  memberships: number
  daysBack: number
  daysAhead: number
}

export const PROD_SCALE: ReportDatasetScale
export const SMALL_SCALE: ReportDatasetScale

export function seedReportDataset(
  admin: SupabaseClient<any, any, any>,
  opts: {
    accountId: string
    clinicIds: string[]
    practitioners: { id: string; name: string }[]
    ownerTeamMemberId: string
    now: Date
    scale: ReportDatasetScale
    seed?: number
  },
): Promise<Record<'patients' | 'appointments' | 'invoices' | 'payments' | 'purchases' | 'messages' | 'memberships', number>>
