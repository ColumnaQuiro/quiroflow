<script setup lang="ts">
// Upserts last_seen_at for this device on every cold start, once a clinic
// is known -- see composables/useAppOpenPing.ts. Only catches cold starts,
// not background->foreground resumes (Capacitor suspends rather than kills
// a backgrounded WebView, so this doesn't refire on a plain app-switch-back;
// true foreground tracking would need @capacitor/app's appStateChange
// listener, a new native dependency not worth adding for this).
onMounted(() => {
  const slug = localStorage.getItem('clinic_slug')
  if (slug) useAppOpenPing().pingAppOpen(slug)
})

// Tapping outside the keyboard didn't dismiss it anywhere in the app --
// Keyboard.resize is 'none' (see capacitor.config.ts), so the WebView never
// resizes and there's no native "tap outside to dismiss" behavior to rely
// on; the OS keyboard only ever hides when the focused field itself loses
// focus. One app-wide listener blurs whatever's focused whenever a tap
// lands on genuinely dead space, which is what actually closes it.
//
// Buttons are explicitly excluded: blurring on pointerdown (before the
// click fires) starts the keyboard-close animation immediately, which
// shifts the composer layout (see useKeyboardInset) out from under the
// finger before touchend -- the Send tap landed on empty space by the time
// it registered, so the keyboard closed but nothing sent, and a *second*
// tap (keyboard now fully closed, button now settled) was what actually
// worked. Skipping blur for any button/link/control lets its own click
// handler run first, on an unmoved layout.
function dismissKeyboardOnOutsideTap(e: PointerEvent) {
  const active = document.activeElement as HTMLElement | null
  if (!active || !['INPUT', 'TEXTAREA'].includes(active.tagName)) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target === active || active.contains(target)) return
  if (target.closest('button, a, [role="button"], input, textarea, select')) return
  active.blur()
}
onMounted(() => document.addEventListener('pointerdown', dismissKeyboardOnOutsideTap))
onUnmounted(() => document.removeEventListener('pointerdown', dismissKeyboardOnOutsideTap))
</script>

<template>
  <!--
    h-screen (not min-h-screen) + overflow-y-auto is deliberate: min-height
    doesn't cap growth, so padding for the safe-area insets was stacking on
    top of an already-100vh-tall box instead of being absorbed within it,
    silently pushing bottom-pinned content (e.g. the Inbox composer) below
    the visible viewport. This is the one bounded, scrollable box for the
    whole app; pages fill it via h-full rather than each claiming their own
    min-h-screen. overflow-x-hidden is explicit because overflow-y-auto alone
    lets a browser treat the x-axis as scrollable too per spec -- any stray
    horizontal nudge (e.g. from a diagonal touch during a page transition)
    then leaves the whole app permanently scrolled sideways, clipping content.

    Only the top inset lives here. The bottom inset is deliberately NOT
    applied at this level: AppTabBar already pads itself for it (so the tabs
    sit above the home indicator), and applying it again here on the outer
    scroll container left a second, empty safe-area-height gap of the page's
    own background below the tab bar -- the "grey area at the bottom"
    reported live on device. Layouts without a tab bar (login, patient view)
    apply their own bottom inset instead; see layouts/default.vue.
  -->
  <div
    class="flex h-screen flex-col overflow-x-hidden overflow-y-auto bg-surface-page font-sans text-ink-700"
    style="padding-top: env(safe-area-inset-top)"
  >
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
