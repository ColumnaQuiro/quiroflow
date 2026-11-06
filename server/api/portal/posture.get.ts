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
export default defineEventHandler(async (event) => {
  const { supabase, user } = await requireAuthedUser(event)
  const patientId = getQuery(event).patientId
  let query = supabase.from('posture_assessments').select('id, taken_at, height_cm, views, metrics').eq('shared_with_patient', true)
  if (typeof patientId === 'string' && patientId) query = query.eq('patient_id', patientId)
  else {
    const { data: own } = await supabase.from('patients').select('id').eq('user_id', user.id)
    query = query.in('patient_id', (own ?? []).map((p) => p.id))
  }
  const { data } = await query.order('taken_at')
  const rows = (data ?? []) as { id: string; taken_at: string; height_cm: number; views: Record<string, { photo: string; width: number; height: number; points: Record<string, [number, number]>; facing: string | null }>; metrics: unknown }[]
  const paths = rows.flatMap((r) => Object.values(r.views).map((v) => v.photo))
  let urls: Record<string, string> = {}
  if (paths.length) {
    const { data: signed } = await serverSupabaseServiceRole<Database>(event).storage.from('patient-files').createSignedUrls(paths, 60 * 30)
    urls = Object.fromEntries((signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])))
  }
  return {
    assessments: rows.map((r) => ({
      id: r.id,
      takenAt: r.taken_at,
      // So the patient side can measure again from the points, as staff do.
      heightCm: r.height_cm,
      metrics: r.metrics,
      views: Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { ...v, photo: undefined, url: urls[v.photo] ?? null }])),
    })),
  }
})
