<script setup lang="ts">
// The app follows the phone's language (mobile/plugins/lang.client.ts); this
// is where someone overrides it. Kept on this device, the way the sign-in
// screens and everything before an account loads read it.
const t = useT()
const { preference, setPreference } = useLang()
const options = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
] as const
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card px-4 py-3.5" data-cy="language-setting">
    <p class="text-[13.5px] font-medium text-ink-900">{{ t('Language', 'Idioma') }}</p>
    <div role="radiogroup" :aria-label="t('Language', 'Idioma')" class="mt-2.5 grid grid-cols-2 gap-[3px] rounded-ctl bg-surface-subtle p-[3px]">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        :lang="option.value"
        :aria-checked="preference === option.value"
        class="h-9 rounded-ctlSm text-[13.5px]"
        :class="preference === option.value ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted'"
        @click="setPreference(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
