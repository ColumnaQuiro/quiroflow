import { Keyboard } from '@capacitor/keyboard'
import { Capacitor } from '@capacitor/core'

// Paired with capacitor.config.ts's Keyboard.resize: 'none' -- the WebView
// no longer resizes itself when the keyboard opens, so nothing moves until
// we say so. Only these two events move anything, and only by exactly the
// keyboard's height: no per-keystroke or scroll-driven repositioning, which
// is what made the old resize:'body' setup feel like it was fighting the
// user while they typed.
const keyboardHeight = ref(0)
let registered = false

export function useKeyboardInset() {
  if (!registered) {
    registered = true
    if (Capacitor.isNativePlatform()) {
      Keyboard.addListener('keyboardWillShow', (info) => {
        keyboardHeight.value = info.keyboardHeight
      })
      Keyboard.addListener('keyboardWillHide', () => {
        keyboardHeight.value = 0
      })
    }
  }
  return { keyboardHeight }
}
