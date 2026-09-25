<script setup lang="ts">
// A setting that is on or off, said in words: a title, what it does, and a
// 44x26 switch -- the full-size one the redesigned settings pages use, where
// SettingsToggle's 34x20 is under the 44px touch target. The whole row's text
// is the switch's label, so a screen reader hears what it turns on.

// data-cy and the like belong on the switch, not the row around it.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    description?: string
    disabled?: boolean
    divided?: boolean
  }>(),
  { description: '', disabled: false, divided: true },
)
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const id = `switch-${Math.random().toString(36).slice(2, 9)}`

function flip() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div class="flex items-start gap-3.5 py-3" :class="divided ? 'border-t border-line-row' : ''">
    <div class="flex flex-1 flex-col gap-0.5">
      <strong :id="`${id}-title`" class="text-[14.5px] text-ink-900">{{ title }}</strong>
      <span v-if="description || $slots.default" :id="`${id}-desc`" class="text-[13px] leading-snug text-ink-500">
        <slot>{{ description }}</slot>
      </span>
    </div>
    <button
      type="button"
      role="switch"
      v-bind="$attrs"
      :aria-checked="modelValue"
      :aria-labelledby="`${id}-title`"
      :aria-describedby="description || $slots.default ? `${id}-desc` : undefined"
      :disabled="disabled"
      class="relative my-[9px] h-[26px] w-11 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50"
      :class="modelValue ? 'bg-brand' : 'bg-line-control'"
      @click="flip"
    >
      <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="modelValue ? 'left-[21px]' : 'left-[3px]'" />
    </button>
  </div>
</template>
