// Privacy mode, for a screen the waiting room can see (an iPad on the desk):
// patients' names become their initials on the agenda and My Day -- the web
// calendar's "Modo privacidad", which blurs them. Staff still know who is
// who; someone reading over the counter does not. Kept on this device.
const KEY = 'quiroflow_privacy_mode'
const on = ref(false)
let loaded = false

export function usePrivacyMode() {
  if (!loaded && import.meta.client) {
    loaded = true
    try {
      on.value = localStorage.getItem(KEY) === '1'
    } catch {}
  }
  function toggle() {
    on.value = !on.value
    try {
      localStorage.setItem(KEY, on.value ? '1' : '0')
    } catch {}
  }
  /** The name as it may be shown: "Alba Serrano", or "A. S." in privacy mode. */
  function shown(name: string) {
    if (!on.value) return name
    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w[0]?.toUpperCase()}.`)
      .join(' ')
  }
  return { privacy: on, togglePrivacy: toggle, shown }
}
