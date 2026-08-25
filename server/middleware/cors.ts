// The mobile app runs its WebView from a Capacitor-local origin
// (capacitor://localhost on iOS), never from app.quiroflow.com -- so every
// /api/** call it makes is genuinely cross-origin, and without this it was
// silently failing at the browser/WebView level (CORS block on the
// response, surfacing to the app as a generic network error) even once the
// request URL itself pointed at the right host. This is what made push
// registration, WhatsApp replies, and in-app messages all fail identically
// with no visible error -- see useAuthedFetch.ts for the matching
// absolute-URL fix this pairs with.
//
// `*` for Allow-Origin is safe here specifically because these routes
// authenticate via a Bearer header (requirePermission.ts), not cookies --
// mobile never sends credentials cross-origin, so there's no
// Allow-Credentials interaction to worry about. The web app's own calls are
// same-origin and unaffected by any of this.
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return

  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (event.method === 'OPTIONS') {
    event.node.res.statusCode = 204
    return ''
  }
})
