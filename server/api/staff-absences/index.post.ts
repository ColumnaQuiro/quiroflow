import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { leaveDatesLabel, absenceKindEs } from '~/server/utils/staffLeave'

// "Pedir vacaciones o ausencia", from "Mi jornada" in the web or the app:
// request_staff_absence() records it as the caller's own and pending, and
// then the owners get a push to decide it (20261016145412_shifts_and_leave.sql).
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireActiveAccount(event)
  const body = await readBody<{ kind?: string; startsOn?: string; endsOn?: string; halfDay?: boolean; note?: string }>(event)
  if (!body?.kind || !body.startsOn || !body.endsOn) throw createError({ statusCode: 400, statusMessage: 'kind, startsOn and endsOn are required' })

  const { data: absence, error } = await supabase.rpc('request_staff_absence', {
    p_account_id: teamMember.account_id,
    p_kind: body.kind,
    p_starts_on: body.startsOn,
    p_ends_on: body.endsOn,
    p_half_day: !!body.halfDay,
    p_note: body.note ?? null,
  })
  if (error || !absence) throw createError({ statusCode: error?.code === '42501' ? 403 : 400, statusMessage: error?.message ?? 'Could not ask for it' })

  // Best-effort: the request stands whether or not anyone was told.
  try {
    const service = serverSupabaseServiceRole<Database>(event)
    const [{ data: owners }, { data: me }] = await Promise.all([
      service.from('team_members').select('user_id').eq('account_id', teamMember.account_id).eq('is_owner', true).is('deleted_at', null).neq('id', teamMember.id),
      service.from('team_members').select('full_name').eq('id', teamMember.id).maybeSingle(),
    ])
    const ids = (owners ?? []).map((o) => o.user_id).filter((u): u is string => !!u)
    if (ids.length) {
      await sendPushToUsers(service, ids, {
        title: `${absenceKindEs(absence.kind)}: ${me?.full_name ?? 'alguien del equipo'}`,
        body: `${leaveDatesLabel(absence.starts_on, absence.ends_on, absence.half_day)}. Pendiente de aprobar.`,
        data: { type: 'jornada' },
      })
    }
  } catch (err) {
    console.error('[staff-absences] owner push failed', err)
  }
  return { absence }
})
