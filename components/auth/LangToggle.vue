<script setup lang="ts">
// ES · EN beside the brand on the signed-out pages. The same preference
// Settings > Appearance writes, so a choice made here is what the app opens
// in afterwards (until a staff member's saved preference loads).
const { preference, setPreference } = useLang()
const options = [
  { value: 'es', label: 'ES', name: 'Español' },
  { value: 'en', label: 'EN', name: 'English' },
] as const

// The server renders English and the browser applies the stored or browser
// language before hydrating, and hydration patches text but not classes or
// attributes -- so a pressed state rendered on the server would stay on EN
// over a Spanish page. Nothing is marked until mounted.
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const isOn = (value: string) => mounted.value && preference.value === value
</script>

<template>
  <div class="flex items-center gap-0.5 text-[12.5px] font-semibold" role="group" aria-label="Idioma / Language">
    <template v-for="(option, i) in options" :key="option.value">
      <span v-if="i" aria-hidden="true" class="text-ink-faint">·</span>
      <button
        type="button"
        :lang="option.value"
        :aria-label="option.name"
        :aria-pressed="isOn(option.value)"
        class="rounded-ctlSm px-1.5 py-1 outline-none focus-visible:shadow-focus"
        :class="isOn(option.value) ? 'text-ink-900' : 'text-ink-faint hover:text-ink-muted'"
        @click="setPreference(option.value)"
      >
        {{ option.label }}
      </button>
    </template>
  </div>
</template>
