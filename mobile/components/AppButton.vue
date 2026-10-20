<script setup lang="ts">
// The app's one action button: every Save, Finish, Change, Cancel visit,
// Bill, Book... is this, so they are all the same height and shape.
//
// They used to be hand-written per screen (h-10 here, h-11 there, py-2.5
// somewhere else), and the h-11 ones were not even 44pt: a fixed height on a
// child of a scrolling flex column is only a preferred size, and once the
// column overflows the browser shrinks the child down to its text. "Save" on
// the patient sheet and "Confirmed by phone" on the visit rendered at about
// 24pt beside 44pt neighbours. min-h plus shrink-0 is what holds it, and a
// label too long for one line grows the button instead of overflowing it.
//
// `to` renders a NuxtLink and `href` an <a>, for the actions that navigate or
// dial; everything else is a <button>.
const props = withDefaults(
  defineProps<{
    // primary: the screen's main action. secondary: the others. danger: a
    // secondary that cancels or removes. strong / destructive: the final tap of
    // something that cannot be taken back (cancelling the visit, closing the
    // till; a confirm dialog's red button). tint: a soft follow-up (book the
    // next visit). quiet: Cancel / Not now under a sheet's main button.
    variant?: 'primary' | 'secondary' | 'danger' | 'strong' | 'destructive' | 'tint' | 'quiet'
    // lg only for the patient-facing reception screen, read at arm's length.
    size?: 'md' | 'lg'
    to?: string
    href?: string
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', to: undefined, href: undefined, type: 'button' },
)

const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : props.href ? 'a' : 'button'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="to || href ? undefined : type"
    class="flex shrink-0 items-center justify-center gap-1.5 rounded-card border text-center leading-tight disabled:opacity-50"
    :class="[
      size === 'lg' ? 'min-h-12 px-6 py-2.5 text-[16px]' : 'min-h-11 px-4 py-2 text-[15px]',
      variant === 'primary' && 'border-brand bg-brand font-semibold text-white active:opacity-90',
      variant === 'secondary' && 'border-line-control bg-surface font-medium text-ink-700 active:bg-surface-subtle',
      variant === 'danger' && 'border-line-control bg-surface font-medium text-danger-text active:bg-surface-subtle',
      variant === 'strong' && 'border-ink-900 bg-ink-900 font-semibold text-surface active:opacity-90',
      variant === 'destructive' && 'border-danger-text bg-danger-text font-semibold text-white active:opacity-90',
      variant === 'tint' && 'border-brand-tintBorder bg-brand-tint font-semibold text-brand-text active:brightness-95',
      variant === 'quiet' && 'border-transparent font-medium text-ink-muted active:bg-surface-subtle',
    ]"
  >
    <slot />
  </component>
</template>
