import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The patient's own posture assessments, the ones their practitioner shared
// ("Lo ve el paciente" on the record), with the photos signed to view.
//
// The authorization IS the read: it runs as the patient, so the "patients
// view own shared posture_assessments" policy decides which rows come back.
// Only then does the service role sign the photos those rows name -- the
// same split as api/patient-files/signed-url.
export default defineEventHandler(async (event) => {
  const { supabase } = await requireAuthedUser(event)
  const { data } = await supabase.from('posture_assessments').select('id, taken_at, height_cm, views, metrics').eq('shared_with_patient', true).order('taken_at')
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
      metrics: r.metrics,
      views: Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { ...v, photo: undefined, url: urls[v.photo] ?? null }])),
    })),
  }
})
