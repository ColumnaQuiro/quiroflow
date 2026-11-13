import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The patient's own posture assessments, the ones their practitioner shared
// ("Lo ve el paciente" on the record), with the photos signed to view.
//
// The authorization IS the read: it runs as the patient, so the "patients
// view own shared posture_assessments" policy decides which rows come back.
// Only then does the service role sign the photos those rows name -- the
// same split as api/patient-files/signed-url.
//
// ?patientId= names whose (family accounts: a parent reading a child's). The
// policy still decides whether that one is readable. Without it -- an app
// release from before family accounts -- the login's own records only, so a
// parent's old app never mixes a child's photos into their own chart.
//
// `comparisons`: the ones the practitioner sent (posture_comparisons), each
// with its two assessments. The same split: the comparison rows are read as
// the patient, and each one read is the permission for its two assessments,
// shared one by one or not -- so those are then read with the service role,
// by the ids the rows name and nothing else.

interface StoredRow { id: string; taken_at: string; height_cm: number; views: Record<string, { photo: string; width: number; height: number; points: Record<string, [number, number]>; facing: string | null }>; metrics: unknown }

export default defineEventHandler(async (event) => {
  const { supabase, user } = await requireAuthedUser(event)
  const patientId = getQuery(event).patientId
  let patientIds: string[]
  if (typeof patientId === 'string' && patientId) patientIds = [patientId]
  else {
    const { data: own } = await supabase.from('patients').select('id').eq('user_id', user.id)
    patientIds = (own ?? []).map((p) => p.id)
  }
  const [{ data }, { data: sent }] = await Promise.all([
    supabase.from('posture_assessments').select('id, taken_at, height_cm, views, metrics').eq('shared_with_patient', true).in('patient_id', patientIds).order('taken_at'),
    supabase.from('posture_comparisons').select('id, patient_id, before_assessment_id, after_assessment_id, note, created_by, updated_at').eq('shared_with_patient', true).in('patient_id', patientIds).order('updated_at', { ascending: false }),
  ])
  const rows = (data ?? []) as unknown as StoredRow[]
  const comparisons = sent ?? []

  const service = serverSupabaseServiceRole<Database>(event)
  let compared: StoredRow[] = []
  let authors = new Map<string, string>()
  if (comparisons.length) {
    const [{ data: pair }, { data: team }] = await Promise.all([
      // Only the assessments those rows name, and only of the patients they are about.
      service.from('posture_assessments').select('id, taken_at, height_cm, views, metrics').in('id', comparisons.flatMap((c) => [c.before_assessment_id, c.after_assessment_id])).in('patient_id', comparisons.map((c) => c.patient_id)),
      service.from('team_members').select('id, full_name').in('id', comparisons.flatMap((c) => (c.created_by ? [c.created_by] : []))),
    ])
    compared = (pair ?? []) as unknown as StoredRow[]
    authors = new Map((team ?? []).map((m) => [m.id, m.full_name]))
  }

  const paths = [...new Set([...rows, ...compared].flatMap((r) => Object.values(r.views).map((v) => v.photo)))]
  let urls: Record<string, string> = {}
  if (paths.length) {
    const { data: signed } = await service.storage.from('patient-files').createSignedUrls(paths, 60 * 30)
    urls = Object.fromEntries((signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])))
  }
  const shape = (r: StoredRow) => ({
    id: r.id,
    takenAt: r.taken_at,
    // So the patient side can measure again from the points, as staff do.
    heightCm: r.height_cm,
    metrics: r.metrics,
    views: Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { ...v, photo: undefined, url: urls[v.photo] ?? null }])),
  })
  const byId = new Map(compared.map((r) => [r.id, r]))
  return {
    assessments: rows.map(shape),
    comparisons: comparisons.flatMap((c) => {
      const before = byId.get(c.before_assessment_id)
      const after = byId.get(c.after_assessment_id)
      if (!before || !after) return []
      return [{ id: c.id, sentAt: c.updated_at, note: c.note, by: c.created_by ? (authors.get(c.created_by) ?? null) : null, before: shape(before), after: shape(after) }]
    }),
  }
})
