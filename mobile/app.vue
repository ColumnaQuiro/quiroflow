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
  -->
  <div
    class="flex h-screen flex-col overflow-x-hidden overflow-y-auto bg-surface-page font-sans text-ink-700"
    style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)"
  >
    <NuxtPage class="flex-1" />
  </div>
</template>
