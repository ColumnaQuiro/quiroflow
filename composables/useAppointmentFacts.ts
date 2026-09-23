// The facts the hover card and the appointment panel's header both state
// about a visit, in the same order: how many visits the patient has had,
// their next one, which visits they still owe for, and how often this one was
// moved. The panel repeats the hover card on purpose -- on a touch screen
// there is no hover card, and nothing it says may be lost.
//
// Cached per appointment for the page's life, so hovering a block and then
// opening it does not load the same four queries twice. refresh() after a
// write that changes any of them.

export interface UnpaidVisit {
  invoiceId: string
  totalCents: number
  /** When the visit was, or when it was charged if it has no visit. */
  at: string
  typeName: string | null
}
export interface RescheduleFact {
  from: string
  to: string
  at: string
}
export interface AppointmentFacts {
  visits: number
  nextVisitAt: string | null
  unpaid: UnpaidVisit[]
  reschedules: RescheduleFact[]
  phone: string | null
}

const cache = new Map<string, Ref<AppointmentFacts | null>>()

export function useAppointmentFacts(appointment: MaybeRefOrGetter<{ id: string; patient_id: string } | null>) {
  const supabase = useSupabaseClient()
  const facts = ref<AppointmentFacts | null>(null)

  async function load(force = false) {
    const a = toValue(appointment)
    if (!a) {
      facts.value = null
      return
    }
    const cached = cache.get(a.id)
    if (cached?.value && !force) {
      facts.value = cached.value
      return
    }
    const [{ count }, { data: next }, { data: invoices }, { data: moves }, { data: phone }] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', a.patient_id).eq('status', 'completed').is('deleted_at', null),
      supabase
        .from('appointments')
        .select('starts_at')
        .eq('patient_id', a.patient_id)
        .eq('status', 'booked')
        .is('deleted_at', null)
        .neq('id', a.id)
        .gt('starts_at', new Date().toISOString())
        .order('starts_at')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, total_cents, created_at, appointments(starts_at, appointment_types(name))')
        .eq('patient_id', a.patient_id)
        .eq('status', 'unpaid')
        .eq('is_refund', false)
        .order('created_at'),
      supabase.from('appointment_reschedules').select('from_starts_at, to_starts_at, created_at').eq('appointment_id', a.id).order('created_at', { ascending: false }),
      supabase.from('patient_contact_numbers').select('number').eq('patient_id', a.patient_id).order('created_at').limit(1).maybeSingle(),
    ])
    // The appointment may have changed while those were in flight.
    if (toValue(appointment)?.id !== a.id) return
    const value: AppointmentFacts = {
      visits: count ?? 0,
      nextVisitAt: next?.starts_at ?? null,
      unpaid: ((invoices as unknown as { id: string; total_cents: number; created_at: string; appointments: { starts_at: string; appointment_types: { name: string } | null } | null }[]) ?? []).map((i) => ({
        invoiceId: i.id,
        totalCents: i.total_cents,
        at: i.appointments?.starts_at ?? i.created_at,
        typeName: i.appointments?.appointment_types?.name ?? null,
      })),
      reschedules: (moves ?? []).map((m) => ({ from: m.from_starts_at, to: m.to_starts_at, at: m.created_at })),
      phone: phone?.number ?? null,
    }
    let slot = cache.get(a.id)
    if (!slot) {
      slot = ref(null)
      cache.set(a.id, slot)
    }
    slot.value = value
    facts.value = value
  }

  watch(() => toValue(appointment)?.id, () => load(), { immediate: true })

  return { facts, refresh: () => load(true) }
}
