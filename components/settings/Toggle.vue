<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="relative inline-flex h-5 w-[34px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="modelValue ? 'bg-brand' : 'bg-toggle-off'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform"
      :class="modelValue ? 'translate-x-[14px]' : 'translate-x-0'"
    />
  </button>
</template>
