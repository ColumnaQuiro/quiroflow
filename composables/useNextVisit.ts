// A patient's next booked visit, for an Inbox thread's header: "Próxima: lun
// 12 oct · 10:00", or that nothing is booked -- what a reply about a visit
// is usually about. Read again when the patient changes; null while there is
// no patient (a number, a lead).
export function useNextVisit(patientId: () => string | null | undefined) {
  const supabase = useSupabaseClient()
  const next = ref<{ id: string; starts_at: string; typeName: string | null } | null>(null)
  const loaded = ref(false)
  let run = 0
  watch(
    patientId,
    async (id) => {
      const mine = ++run
      next.value = null
      loaded.value = false
      if (!id) return
      const { data } = await supabase
        .from('appointments')
        .select('id, starts_at, appointment_types(name)')
        .eq('patient_id', id)
        .eq('status', 'booked')
        .is('deleted_at', null)
        .gt('starts_at', new Date().toISOString())
        .order('starts_at')
        .limit(1)
        .maybeSingle()
      if (mine !== run) return
      const row = data as { id: string; starts_at: string; appointment_types: { name: string } | null } | null
      next.value = row ? { id: row.id, starts_at: row.starts_at, typeName: row.appointment_types?.name ?? null } : null
      loaded.value = true
    },
    { immediate: true },
  )
  return { next, loaded }
}
