import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { staffSectionIncluded } from '~/utils/growthPlans'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { staffDocumentCategoryLabel, staffDocumentPeriodLabel, visibleToPerson } from '~/utils/staffDocuments'

// After an owner uploads documents in Personal: a push to each person whose
// papers just arrived ("Tu nómina de octubre de 2026"), opening Mi jornada,
// where Mis documentos is. A parte de baja is never announced: the person
// cannot see it. Best-effort, as every staff push is: the upload stands
// whether or not anyone was told.
const es = (en: string, spanish: string) => spanish

export default defineEventHandler(async (event) => {
  const { teamMember, subscription } = await requireActiveAccount(event)
  if (!staffSectionIncluded(subscription)) throw createError({ statusCode: 402, statusMessage: 'Personal comes with the Practice and Clinic plans.' })
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Owners only' })
  const body = await readBody<{ ids?: string[] }>(event)
  const ids = (body?.ids ?? []).filter((x) => typeof x === 'string').slice(0, 200)
  if (!ids.length) return { sent: 0 }

  const service = serverSupabaseServiceRole<Database>(event)
  const { data: docs } = await service
    .from('staff_documents')
    .select('id, team_member_id, category, period, team_members!staff_documents_team_member_id_fkey(user_id, deleted_at)')
    .eq('account_id', teamMember.account_id)
    .in('id', ids)
  const byUser = new Map<string, { category: string; period: string | null }[]>()
  for (const d of (docs ?? []) as unknown as { category: string; period: string | null; team_members: { user_id: string | null; deleted_at: string | null } | null }[]) {
    const user = d.team_members?.user_id
    if (!user || d.team_members?.deleted_at || !visibleToPerson(d)) continue
    byUser.set(user, [...(byUser.get(user) ?? []), d])
  }
  let sent = 0
  for (const [user, list] of byUser) {
    const one = list.length === 1 ? list[0]! : null
    const title = one
      ? one.category === 'payslip' && one.period
        ? `Tu nómina de ${staffDocumentPeriodLabel(one.period, 'es-ES')}`
        : `Nuevo documento: ${staffDocumentCategoryLabel(one.category, es)}`
      : `${list.length} documentos nuevos`
    try {
      const r = await sendPushToUsers(service, [user], { title, body: 'Está en Mi jornada › Mis documentos.', data: { type: 'jornada' } })
      sent += r.delivered
    } catch (err) {
      console.error('[staff-documents] push failed', err)
    }
  }
  return { sent }
})
