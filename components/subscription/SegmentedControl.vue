<script setup lang="ts">
// Plan / Billing / Payments. Real tabs: one tab stop, arrows move between
// them, and the panel is labelled by the active tab.
const props = defineProps<{ items: { key: string; label: string }[]; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const index = props.items.findIndex((i) => i.key === props.modelValue)
  const last = props.items.length - 1
  const next =
    event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowRight' ? Math.min(last, index + 1) : Math.max(0, index - 1)
  const item = props.items[next]
  if (!item) return
  emit('update:modelValue', item.key)
  nextTick(() => root.value?.querySelector<HTMLElement>(`[data-key="${item.key}"]`)?.focus())
}
</script>

<template>
  <div
    ref="root"
    role="tablist"
    class="inline-flex gap-0.5 rounded-[9px] border border-chip-border bg-chip-bg p-[3px]"
    @keydown="onKeydown"
  >
    <!-- 44px below lg: on a phone these are the page's primary navigation. -->
    <button
      v-for="item in items"
      :key="item.key"
      :data-key="item.key"
      type="button"
      role="tab"
      :aria-selected="item.key === modelValue"
      :tabindex="item.key === modelValue ? 0 : -1"
      class="inline-flex h-11 items-center rounded-[7px] px-3.5 text-[13px] outline-none lg:h-[30px]"
      :class="
        item.key === modelValue
          ? 'border border-line-control bg-surface font-semibold text-ink-900 shadow-card'
          : 'font-medium text-ink-muted hover:text-ink-700 focus-visible:text-ink-700'
      "
      @click="emit('update:modelValue', item.key)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
