<script setup lang="ts">
// The theme switch, beside the account menu -- the only place the theme is
// chosen now (/account no longer repeats it). See composables/useTheme.ts.
// `resolved` is deliberately not read here. Which icon to show is decided in
// CSS off the data-theme attribute instead -- see the style block below for
// why.
const { preference, setPreference } = useTheme()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

const open = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const options = computed(() => [
  { value: 'light' as const, label: t('Light', 'Claro') },
  { value: 'dark' as const, label: t('Dark', 'Oscuro') },
  { value: 'system' as const, label: t('System', 'Sistema') },
])

function onDocumentClick(e: MouseEvent) {
  if (open.value && menuRef.value && !menuRef.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

// Saved to the team member as well as the browser. The account store
// re-applies team_members.theme_preference on every load (stores/account.ts),
// so a choice kept only in localStorage would be undone by the next reload --
// and would not follow the person to their other devices.
async function choose(value: 'light' | 'dark' | 'system') {
  setPreference(value)
  open.value = false
  const tm = store.teamMember
  if (!tm || tm.theme_preference === value) return
  tm.theme_preference = value
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', tm.id)
}
</script>

<template>
  <div ref="menuRef" class="relative">
    <button
      type="button"
      class="flex h-7 w-7 items-center justify-center rounded-ctl border border-line-control bg-chip-bg text-ink-muted hover:bg-surface-subtle"
      :title="t('Appearance', 'Apariencia')"
      :aria-label="t('Appearance', 'Apariencia')"
      data-cy="theme-toggle"
      @click="open = !open"
    >
      <svg class="theme-icon theme-icon--dark" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13.5 9.3A5.8 5.8 0 016.7 2.5a5.8 5.8 0 106.8 6.8z" />
      </svg>
      <svg class="theme-icon theme-icon--light" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <circle cx="8" cy="8" r="3.2" />
        <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.4 3.6l-1.15 1.15M4.75 11.15L3.6 12.4M12.4 12.4l-1.15-1.15M4.75 4.75L3.6 3.6" />
      </svg>
    </button>
    <div v-if="open" class="absolute right-0 top-full z-40 mt-1 w-36 rounded-ctl border border-line bg-surface py-1 shadow-popover">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        :data-cy="`theme-option-${opt.value}`"
        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px]"
        :class="preference === opt.value ? 'font-medium text-brand-text' : 'text-ink-500 hover:bg-surface-subtle'"
        @click="choose(opt.value)"
      >
        {{ opt.label }}
        <svg v-if="preference === opt.value" width="11" height="11" viewBox="0 0 12 12" class="shrink-0"><path d="M2.5 6.3l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Which icon belongs here depends on the resolved theme, and that lives only
   in localStorage and matchMedia. Picking it with `v-if="resolved === 'dark'"`
   meant the server always rendered the sun (preference defaults to 'system',
   systemDark to false) and the client swapped in the moon during hydration --
   a `<circle>` where Vue expected a `<path>`, so every page load logged a
   hydration mismatch for anyone not on the light theme.
   Both icons ship in the HTML now and CSS chooses, keyed off the same
   data-theme attribute useTheme()'s client plugin already sets synchronously
   before first paint. Server and client vdom are identical, and the icon is
   still correct on the very first frame. */
.theme-icon--dark {
  display: none;
}
:root[data-theme='dark'] .theme-icon--dark {
  display: block;
}
:root[data-theme='dark'] .theme-icon--light {
  display: none;
}
</style>
