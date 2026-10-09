import { sharedFetch } from './useSharedFetch'
import { fetchAllRows } from './useFetchAllRows'
import { getWeekRange, rangeBounds } from './useDateRangePresets'

export interface WeekAppointmentRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

// This week's appointments, for the three dashboard widgets that read them
// (visits this week, the visit summary, the no-show rate). They sit side by
// side on the default dashboard and each used to ask for the same rows on
// its own; asked through here, they share one request. The query is each
// widget's own -- starts_at within Monday-Sunday of this week, the
// practitioner and clinic filter when set -- with the union of their columns.
export function useThisWeekAppointments() {
  const supabase = useSupabaseClient()
  return (practitionerId?: string, clinicId?: string): Promise<WeekAppointmentRow[]> => {
    const { from, to } = getWeekRange()
    const { from: fromDate, to: toDate } = rangeBounds({ from, to })
    return sharedFetch(`week-appointments:${fromDate.toISOString()}:${toDate.toISOString()}:${practitionerId ?? ''}:${clinicId ?? ''}`, () => {
      let query = supabase
        .from('appointments')
        .select('id, starts_at, status, appointment_types(name)')
        .gte('starts_at', fromDate.toISOString())
        .lte('starts_at', toDate.toISOString())
      if (practitionerId) query = query.eq('practitioner_id', practitionerId)
      if (clinicId) query = query.eq('clinic_id', clinicId)
      return fetchAllRows<WeekAppointmentRow>((f, t) => query.range(f, t) as unknown as PromiseLike<{ data: WeekAppointmentRow[] | null; error: unknown }>)
    })
  }
}
