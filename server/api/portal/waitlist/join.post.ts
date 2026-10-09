import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { pushPatientAction } from '~/server/utils/staffPush'

// A patient joining their clinic's waitlist ("Avísame"), from the app or the
// portal -- and the clinic being told, which a bare RPC from the browser
// could not do (the same reason as appointments/cancel.post.ts).
//
// The joining itself is still join_my_waitlist, run as the patient: whether
// the clinic takes self-service, and whose entry it is, are decided there.
// Only a new entry tells anyone: joining twice returns the one already there,
// and the front desk does not need hearing about it again.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ clinicId?: string }>(event)
  if (!body?.clinicId) throw createError({ statusCode: 400, statusMessage: 'clinicId is required' })

  const { supabase } = await requireAuthedUser(event)
  const { data: before } = await supabase.rpc('get_my_waitlist' as never)
  const already = ((before as { id: string; clinic_id: string }[] | null) ?? []).find((e) => e.clinic_id === body.clinicId)
  if (already) return { entryId: already.id, created: false }

  const { data: entryId, error } = await supabase.rpc('join_my_waitlist' as never, { p_clinic_id: body.clinicId } as never)
  if (error || !entryId) throw createError({ statusCode: 400, statusMessage: error?.message ?? 'Could not join the waitlist' })

  const service = serverSupabaseServiceRole<Database>(event)
  try {
    const { data: entry } = await service.from('waitlist_entries').select('patient_id, clinic_id, clinics(name), patients(first_name, last_name)').eq('id', entryId as unknown as string).maybeSingle()
    const e = entry as unknown as { patient_id: string; clinics: { name: string } | null; patients: { first_name: string; last_name: string | null } | null } | null
    if (e) {
      // Whoever sees them next is the one most likely to fit them in earlier.
      const { data: next } = await service
        .from('appointments')
        .select('practitioner_id')
        .eq('patient_id', e.patient_id)
        .eq('clinic_id', body.clinicId)
        .eq('status', 'booked')
        .is('deleted_at', null)
        .gte('starts_at', new Date().toISOString())
        .order('starts_at')
        .limit(1)
        .maybeSingle()
      const name = `${e.patients?.first_name ?? ''} ${e.patients?.last_name ?? ''}`.trim()
      await pushPatientAction(service, {
        patientId: e.patient_id,
        practitionerId: (next as { practitioner_id: string | null } | null)?.practitioner_id ?? null,
        title: 'Se apuntó a la lista de espera',
        body: [name, e.clinics?.name].filter(Boolean).join(' · '),
        data: { target: 'waitlist' },
      })
    }
  } catch (err) {
    console.error('[waitlist-join] telling the clinic failed', entryId, err)
  }
  return { entryId, created: true }
})
