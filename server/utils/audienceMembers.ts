import type { AudienceRef } from '~/utils/automationAudience'

// Who is in a saved audience -- a patient list, or a segment's snapshot
// (refreshed every 15 minutes and whenever the segment is saved) -- read
// through the Lists functions (20261105143740_patient_lists_and_audiences):
// audience_members for now, audience_entries_since for who came in after a
// moment. Neither applies consent; the caller keeps its own gates.
//
// The service role sees every account's rows, so these ids are only ever
// intersected with the rule's own account's patients, never used on their
// own: a rule naming another clinic's list can reach nobody.

const PAGE = 1000

async function pagedRpc<T>(service: any, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await service.rpc(fn, args).range(from, from + PAGE - 1)
    // Thrown, not swallowed: half an audience read as the whole of it is
    // exactly the silent loss to avoid.
    if (error) throw new Error(`${fn} failed: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Who is in the audience now, less whoever is in any of `exclude`. */
export async function audienceMemberIds(service: any, audience: AudienceRef, exclude: AudienceRef[] = []): Promise<Set<string>> {
  const members = await pagedRpc<{ patient_id: string }>(service, 'audience_members', { p_kind: audience.kind, p_id: audience.id })
  const ids = new Set(members.map((m) => m.patient_id))
  for (const ex of exclude) {
    for (const m of await pagedRpc<{ patient_id: string }>(service, 'audience_members', { p_kind: ex.kind, p_id: ex.id })) ids.delete(m.patient_id)
  }
  return ids
}

/** Who is in the audience now, with when each came in. */
export function audienceMembersNow(service: any, audience: AudienceRef): Promise<{ patient_id: string; entered_at: string }[]> {
  return pagedRpc(service, 'audience_members', { p_kind: audience.kind, p_id: audience.id })
}

/** Who entered the audience after `since`, oldest first; someone who came back appears again. */
export function audienceEntriesSince(service: any, audience: AudienceRef, since: string): Promise<{ patient_id: string; entered_at: string }[]> {
  return pagedRpc(service, 'audience_entries_since', { p_kind: audience.kind, p_id: audience.id, p_since: since })
}

/** Whether the list or segment still exists: a deleted one is an audience of nobody, said as such rather than sent to nobody quietly. */
export async function audienceExists(service: any, audience: AudienceRef): Promise<boolean> {
  const { data } = await service.from(audience.kind === 'list' ? 'patient_lists' : 'patient_segments').select('id').eq('id', audience.id).maybeSingle()
  return !!data
}
