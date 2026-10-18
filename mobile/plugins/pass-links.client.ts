import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { patientIdFromPassLink } from '../../utils/passLink'

// A bono pass's QR, scanned with the iPhone or Android camera, opens the app
// on https://app.quiroflow.com/patients/<id> (applinks in App.entitlements and
// public/.well-known/apple-app-site-association; the App Links intent filter
// and assetlinks.json on Android). This takes it from there.
//
// Staff land on the patient as the Scan button does (openPatientFromPass).
// The same app is the patient's too, and a patient scanning their own card
// has no business on a staff screen: they go to their home. Signed out, it
// does nothing -- the login screen is what they see, and the link is not
// worth remembering across it.
export default defineNuxtPlugin(() => {
  if (!Capacitor.isNativePlatform()) return
  const supabase = useSupabaseClient()

  // A cold start can deliver the same link twice (getLaunchUrl and
  // appUrlOpen); one navigation is enough.
  let last = ''
  async function open(url: string | undefined) {
    const patientId = patientIdFromPassLink(url)
    if (!patientId || url === last) return
    last = url!
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: staff } = await supabase.from('team_members').select('id').eq('user_id', session.user.id).is('deleted_at', null).limit(1)
    if (staff?.length) await openPatientFromPass(patientId)
    else await navigateTo('/')
  }

  App.addListener('appUrlOpen', ({ url }) => {
    open(url)
  })
  App.getLaunchUrl().then((launch) => open(launch?.url))
})
