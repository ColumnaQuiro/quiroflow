import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { leaveDatesLabel, absenceKindEs } from '~/server/utils/staffLeave'
import { nextDate, startOfLocalDate } from '~/utils/clinicClock'

// An owner approves or rejects a leave request. decide_staff_absence() blocks
// the person's calendar when it is approved; this then tells them, and
// answers how many visits they still have booked those days, so the page can
// offer to move them ("Ausencia imprevista").
export default defineEventHandler(async (event) => {
  const { supabase } = await requireActiveAccount(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ approve?: boolean }>(event)
  if (!id || typeof body?.approve !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'approve is required' })

  const { data: absence, error } = await supabase.rpc('decide_staff_absence', { p_absence_id: id, p_approve: body.approve })
  if (error || !absence) throw createError({ statusCode: error?.code === '42501' ? 403 : 400, statusMessage: error?.message ?? 'Could not decide it' })

  const service = serverSupabaseServiceRole<Database>(event)
  let visits = 0
  if (absence.status === 'approved') {
    const { data: clinic } = await service.from('clinics').select('timezone').eq('account_id', absence.account_id).is('archived_at', null).order('created_at').limit(1).maybeSingle()
    const tz = clinic?.timezone || 'Europe/Madrid'
    const from = startOfLocalDate(absence.starts_on, tz).toISOString()
    const to = startOfLocalDate(nextDate(absence.ends_on), tz).toISOString()
    const { count } = await service.from('appointments').select('id', { count: 'exact', head: true }).eq('practitioner_id', absence.team_member_id).eq('status', 'booked').is('deleted_at', null).gte('starts_at', from).lt('starts_at', to)
    visits = count ?? 0
  }

  try {
    const { data: person } = await service.from('team_members').select('user_id').eq('id', absence.team_member_id).maybeSingle()
    if (person?.user_id) {
      await sendPushToUsers(service, [person.user_id], {
        title: `${absenceKindEs(absence.kind)} ${absence.status === 'approved' ? 'aprobada' : 'rechazada'}`,
        body: leaveDatesLabel(absence.starts_on, absence.ends_on, absence.half_day),
        data: { type: 'jornada' },
      })
    }
  } catch (err) {
    console.error('[staff-absences] push to the person failed', err)
  }
  return { absence, visits }
})
