<script setup lang="ts">
// Label, optional description, control, optional error.
//
// The description sits ABOVE the control rather than below it. Below reads
// more naturally, but the country field's popover opens downward and would
// cover the one line explaining what the field is for.
// `error` carries a plain message; `invalid` is for the cases where the
// message needs markup (a link out of the error) and arrives via the slot.
withDefaults(defineProps<{ id: string; label: string; description?: string; error?: string; invalid?: boolean }>(), {
  description: undefined,
  error: undefined,
  invalid: false,
})
</script>

<template>
  <div>
    <label :for="id" class="block text-[14px] font-medium text-ink-700" :class="description ? 'mb-[3px]' : 'mb-1.5'">
      {{ label }}
    </label>
    <p v-if="description" :id="`${id}-description`" class="mb-1.5 text-[12.5px] leading-[1.4] text-ink-muted">
      {{ description }}
    </p>

    <slot />

    <p
      v-if="error || invalid"
      :id="`${id}-error`"
      role="alert"
      class="mt-[7px] flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-danger-text"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="mt-px h-3.5 w-3.5 shrink-0">
        <circle cx="8" cy="8" r="5.9" stroke="currentColor" stroke-width="1.4" />
        <path d="M8 5.1V8.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="8" cy="10.8" r="0.85" fill="currentColor" />
      </svg>
      <span><slot name="error">{{ error }}</slot></span>
    </p>
  </div>
</template>
