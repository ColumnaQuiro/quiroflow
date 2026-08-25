import { Capacitor } from '@capacitor/core'

// Real "has the app been installed/opened" tracking for Settings > App's
// analytics (device_push_tokens alone undercounts -- it only has rows for
// devices that granted notification permission). One row per device,
// upserted via record_app_open() -- no direct table write path, since this
// fires from mobile/pages/join.vue before there's necessarily any signed-in
// session at all.
export function useAppOpenPing() {
  const supabase = useSupabaseClient()

  function getOrCreateDeviceId() {
    let id = localStorage.getItem('device_id')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('device_id', id)
    }
    return id
  }

  async function pingAppOpen(accountSlug: string) {
    const { error } = await supabase.rpc('record_app_open', {
      p_account_slug: accountSlug,
      p_device_id: getOrCreateDeviceId(),
      p_platform: Capacitor.getPlatform() as 'ios' | 'android' | 'web',
    })
    return { error }
  }

  return { pingAppOpen }
}
