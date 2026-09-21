<script setup lang="ts">
// Keyboard behaviour for a row of mutually exclusive tiles.
//
// A radio group is one tab stop, not one per option: Tab reaches the selected
// tile, arrows move between them, and Tab leaves. That is what the roving
// tabindex on OnboardingSelectTile is for; this component owns the arrow keys.
defineProps<{ label: string; columns: 2 | 3 }>()

const root = ref<HTMLElement | null>(null)

function tiles(): HTMLButtonElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[data-onboarding-tile]') ?? [])
}

function onKeydown(event: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
  if (!keys.includes(event.key)) return
  const all = tiles()
  const index = all.indexOf(document.activeElement as HTMLButtonElement)
  if (index === -1) return
  event.preventDefault()
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
  const next = all[(index + (forward ? 1 : -1) + all.length) % all.length]
  // Selection follows focus, which is what a radio group does and what makes
  // the theme and language choices apply as you arrow across them.
  next?.focus()
  next?.click()
}
</script>

<template>
  <div
    ref="root"
    role="radiogroup"
    :aria-label="label"
    class="grid gap-[11px]"
    :class="columns === 3 ? 'grid-cols-3' : 'grid-cols-2'"
    @keydown="onKeydown"
  >
    <slot />
  </div>
</template>
