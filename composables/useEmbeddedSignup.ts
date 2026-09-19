// Meta's Embedded Signup, which is the whole reason QuiroFlow registered as a
// WhatsApp Tech Provider: a clinic connects WhatsApp by clicking a button and
// stepping through Meta's own dialog, instead of creating a Meta app,
// generating a permanent token and pasting four values into Settings.
//
// The flow is a popup, not a redirect. FB.login() opens Meta's dialog, and
// what comes back is a short-lived CODE -- not a token. Only the server can
// turn that into a token, because only the server has the app secret, which
// is why /api/meta/connect/callback exists and why nothing here ever sees a
// credential.

interface SessionInfo {
  event?: 'FINISH' | 'CANCEL' | 'ERROR' | string
  data?: { error_message?: string }
}

declare global {
  interface Window {
    FB?: any
    fbAsyncInit?: () => void
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js'
const GRAPH_VERSION = 'v21.0'

let sdkReady: Promise<void> | null = null

function loadSdk(appId: string): Promise<void> {
  // Once per page, not once per click: FB.init() twice is not harmless, and a
  // clinic that closes the dialog and tries again would otherwise re-init.
  if (sdkReady) return sdkReady

  sdkReady = new Promise<void>((resolve, reject) => {
    if (window.FB) return resolve()

    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: GRAPH_VERSION })
      resolve()
    }

    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.crossOrigin = 'anonymous'
    // A blocked or failed script must reject rather than hang: the button
    // would otherwise sit in "Connecting…" forever with nothing said, which
    // is exactly how an ad blocker presents.
    script.onerror = () => {
      sdkReady = null
      reject(new Error('Could not load Meta’s login script. A browser extension or content blocker is the usual cause.'))
    }
    document.head.appendChild(script)
  })

  return sdkReady
}

export function useEmbeddedSignup() {
  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const configId = config.public.metaEmbeddedSignupConfigId

  /** Whether this deployment has the platform app wired up at all. */
  const available = computed(() => Boolean(appId && configId))

  /**
   * Opens Meta's dialog and resolves with the authorization code.
   *
   * Rejects, rather than resolving with null, when the clinic closes the
   * dialog -- the caller wants to tell those two apart, and "nothing
   * happened" is a different message from "something broke".
   */
  async function launch(): Promise<string> {
    if (!available.value) throw new Error('WhatsApp connect is not configured on this deployment.')
    await loadSdk(appId)

    return new Promise<string>((resolve, reject) => {
      // Meta reports what happened INSIDE the dialog here -- the FB.login
      // callback only says whether a code came back. Without this, a clinic
      // that cancels and one that hit an error inside the flow look
      // identical from the outside.
      //
      // The same message also carries waba_id and phone_number_id. They are
      // deliberately ignored: the server reads both from the token's own
      // granular scopes instead, because anything the browser sends could be
      // swapped for another clinic's ids.
      let sessionOutcome: SessionInfo | null = null

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
        try {
          const parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          if (parsed?.type === 'WA_EMBEDDED_SIGNUP') sessionOutcome = parsed as SessionInfo
        } catch {
          // Facebook posts plenty of other, non-JSON messages to this origin.
          // Not ours, not a problem.
        }
      }
      window.addEventListener('message', onMessage)

      const finish = (fn: () => void) => {
        window.removeEventListener('message', onMessage)
        fn()
      }

      window.FB.login(
        (response: any) => {
          const code = response?.authResponse?.code
          if (code) return finish(() => resolve(code))

          if (sessionOutcome?.event === 'ERROR') {
            const detail = sessionOutcome.data?.error_message ?? 'Meta did not say why.'
            return finish(() => reject(new Error(detail)))
          }
          return finish(() => reject(new Error('CANCELLED')))
        },
        {
          config_id: configId,
          response_type: 'code',
          // Without this the SDK insists on returning a user access token,
          // which is the wrong credential entirely: Tech Providers use
          // business tokens, and those come from exchanging a code server
          // side.
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        },
      )
    })
  }

  return { available, launch }
}
