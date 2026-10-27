// Array.prototype.at for Android System WebViews older than Chrome 92.
//
// Nuxt's own router plugin reads `from.matched.at(-1)` in an afterEach
// guard, so on such a WebView the very first navigation throws
// "matched.at is not a function" and the app opens on an error screen
// (QUIROFLOW-APP-3; seen on Play's pre-launch test devices). The build
// transpiles syntax but adds no polyfills for built-ins, and minSdk 26
// lets the app install on phones whose WebView was never updated.
//
// A plugin is early enough: the initial navigation runs on app:created,
// after every plugin has been set up.
export default defineNuxtPlugin(() => {
  if (typeof Array.prototype.at === 'function') return
  Object.defineProperty(Array.prototype, 'at', {
    value: function at<T>(this: T[], index: number): T | undefined {
      const i = Math.trunc(index) || 0
      return this[i < 0 ? this.length + i : i]
    },
    writable: true,
    configurable: true,
  })
})
