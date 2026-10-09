// "Cómo llegar" and "Llamar" for a clinic, as links the phone hands to the
// right app: Apple Maps on an iPhone, Google Maps elsewhere, the dialler for
// a tel: link. Pure, so it is shared by the app and tested.

export interface ClinicContact {
  name: string
  address: string | null
  phone: string | null
}

/** Directions to the clinic, or null when it has no address to go to. */
export function directionsUrl(clinic: ClinicContact, platform: string | null | undefined): string | null {
  const address = clinic.address?.trim()
  if (!address) return null
  // The name as well as the address: a search for "Clínica Demo, Calle
  // Mayor 12" lands on the clinic's own listing where Maps has one.
  const query = encodeURIComponent([clinic.name?.trim(), address].filter(Boolean).join(', '))
  return platform === 'ios' ? `https://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`
}

/** A tel: link with only what a dialler reads, or null without a number. */
export function telUrl(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '')
  return digits.replace(/\+/g, '').length >= 6 ? `tel:${digits}` : null
}

/**
 * 'ios' on an iPhone or iPad -- the app's own Capacitor platform, or Safari's
 * user agent in the web portal -- so directions open in Apple Maps there.
 */
export function devicePlatform(win: { Capacitor?: { getPlatform?: () => string }; navigator?: { userAgent?: string; maxTouchPoints?: number } } | undefined): string {
  if (!win) return 'web'
  const native = win.Capacitor?.getPlatform?.()
  if (native && native !== 'web') return native
  const ua = win.navigator?.userAgent ?? ''
  // iPadOS reports itself as a Mac; the touch points give it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (win.navigator?.maxTouchPoints ?? 0) > 1)) return 'ios'
  return /Android/.test(ua) ? 'android' : 'web'
}
