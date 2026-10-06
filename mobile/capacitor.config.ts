import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.quiroflow.app',
  appName: 'QuiroFlow',
  webDir: '.output/public',
  // Android 15+ draws apps edge to edge (targetSdk 36): without margins the
  // WebView sits under the status and navigation bars, where Android's
  // WebView reports no safe-area insets to pad by. 'auto' adds the margins
  // natively on exactly those versions (Capacitor 8's default).
  android: {
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    // 'body' resizes the whole WebView viewport when the keyboard opens --
    // on a 100vh-based layout that triggers a full relayout plus the
    // WebView's native "scroll focused input into view" behavior, which is
    // what produced the reported jump (message list scrolling, content
    // disappearing off the top) on every keystroke, not just when the
    // keyboard actually opens. 'none' leaves the WebView's own size alone;
    // useKeyboardInset (mobile/composables/useKeyboardInset.ts) listens for
    // the plugin's show/hide events instead and nudges only the composer up
    // by the keyboard's height, once, when the keyboard transitions.
    Keyboard: {
      resize: 'none',
    },
  },
}

export default config
