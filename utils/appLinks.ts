// Where the QuiroFlow patient app lives in the two stores.
//
// One module, because the same two links now appear on the booking
// confirmation, on the patient portal and in Settings > Patient app. Three
// copies of a URL is three places to forget when one of them changes.

/** Bundle ID on iOS, package name on Android -- the same string for both. */
export const APP_BUNDLE_ID = 'com.quiroflow.app'

/**
 * The App Store's own numeric ID for the app -- a ten-digit number, NOT the
 * bundle ID above. Apple has no public URL shape keyed on a bundle ID, so
 * this number is the only way to link straight to the listing.
 *
 * Find it in App Store Connect > Apps > QuiroFlow > General > App
 * Information, where it is labelled "Apple ID", or by copying the app's
 * "View on App Store" link and taking the digits after `id`.
 *
 * While it is empty, `appStoreUrl()` returns null and every caller hides its
 * iOS button rather than shipping a link that 404s at a patient.
 */
export const APP_STORE_NUMERIC_ID = ''

/**
 * Spain-only storefront, deliberately -- see CLAUDE.md "Releasing the mobile
 * app". A bare apps.apple.com/app/id… link resolves against the visitor's own
 * storefront, which for anyone outside Spain is a "not available" page rather
 * than the app.
 */
export function appStoreUrl(): string | null {
  return APP_STORE_NUMERIC_ID ? `https://apps.apple.com/es/app/quiroflow/id${APP_STORE_NUMERIC_ID}` : null
}

/** Play resolves the listing from the package name, so this needs no second identifier. */
export function playStoreUrl(): string {
  return `https://play.google.com/store/apps/details?id=${APP_BUNDLE_ID}`
}

/** False only while the App Store ID is still missing, i.e. iOS is hidden everywhere. */
export function hasBothStores(): boolean {
  return appStoreUrl() !== null
}
