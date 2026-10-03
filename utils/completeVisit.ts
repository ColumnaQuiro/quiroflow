/**
 * Mark a visit completed, as one compare-and-set, and say whether THIS call
 * is the one that completed it.
 *
 * A visit can be completed from several places: paying it in full and drawing
 * it from a bono (both in composables/useVisitCharging.ts), "Done" on the
 * web's appointment panel, and "Finish visit" in the staff app. Each wrote
 * status = 'completed' unconditionally and then fired 'appointment.completed'
 * -- so a visit finished in the app and paid at the desk afterwards fired the
 * event twice, and an automation hanging off it (a review request, a
 * follow-up message) reached the patient twice.
 *
 * The update only matches a row that is not completed yet. Fire the event
 * when `completedNow` is true and not otherwise. The status ends up
 * 'completed' either way, exactly as before.
 *
 * `.select()` is what makes the answer trustworthy: an update with no select
 * returns no rows, so a refused write and a no-op look the same as success.
 */
export async function completeVisit(supabase: any, appointmentId: string): Promise<{ completedNow: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'completed' })
    .eq('id', appointmentId)
    .neq('status', 'completed')
    .select('id')
  if (error) return { completedNow: false, error: error.message as string }
  return { completedNow: ((data as unknown[] | null) ?? []).length > 0, error: null }
}
