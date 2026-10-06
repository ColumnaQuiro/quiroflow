<script setup lang="ts">
// Appearance: the phone's own setting by default, or always light / dark.
// Kept on this device (useTheme), like the language beside it.
const t = useT()
const { preference, setPreference } = useTheme()
const options = computed(() => [
  { value: 'system' as const, label: t('Automatic', 'Automático') },
  { value: 'light' as const, label: t('Light', 'Claro') },
  { value: 'dark' as const, label: t('Dark', 'Oscuro') },
])
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card px-4 py-3.5" data-cy="theme-setting">
    <p class="text-[13.5px] font-medium text-ink-900">{{ t('Appearance', 'Apariencia') }}</p>
    <div role="radiogroup" :aria-label="t('Appearance', 'Apariencia')" class="mt-2.5 grid grid-cols-3 gap-[3px] rounded-ctl bg-surface-subtle p-[3px]">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="preference === option.value"
        class="h-9 rounded-ctlSm text-[13.5px]"
        :class="preference === option.value ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'"
        :data-cy="`theme-${option.value}`"
        @click="setPreference(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
