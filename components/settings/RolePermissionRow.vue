<script setup lang="ts">
import type { PermissionRow } from '~/utils/rolePermissions'

// One permission in the roles editor. A real, labelled control either way:
// the switch is named by its label (a <label for> pointing at the button, so
// clicking the words toggles it, as with a checkbox), and the three- and
// two-way choices are a radiogroup named by theirs. The old rows were an
// unnamed role="switch" beside a <span>, which a screen reader announced as
// "switch, off" with nothing to say what it switched.

const props = defineProps<{ row: PermissionRow; modelValue: string | boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string | boolean] }>()

// useId, not Math.random: stable between the server render and hydration.
const uid = `perm-${props.row.key}-${useId()}`

function pick(value: string) {
  if (!props.disabled) emit('update:modelValue', value)
}

// Arrow keys move the choice, as a native radio group does; Tab reaches the
// group once, at the checked option.
function onKey(e: KeyboardEvent, index: number) {
  if (props.row.kind !== 'scope') return
  const options = props.row.options
  let next = -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
  if (next < 0) return
  e.preventDefault()
  pick(options[next].value)
  const group = (e.currentTarget as HTMLElement).parentElement
  ;(group?.children[next] as HTMLElement | undefined)?.focus()
}
</script>

<template>
  <div v-if="row.kind === 'toggle'" class="flex items-start gap-3.5 border-t border-line-row py-3" data-cy="role-perm" :data-key="row.key">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <label :for="uid" class="cursor-pointer text-[14.5px] font-semibold text-ink-900" :class="disabled ? 'cursor-default' : ''">{{ row.label }}</label>
      <span v-if="row.description" :id="`${uid}-d`" class="text-[13px] leading-snug text-ink-500">{{ row.description }}</span>
    </div>
    <button
      :id="uid"
      type="button"
      role="switch"
      :aria-checked="modelValue === true"
      :aria-describedby="row.description ? `${uid}-d` : undefined"
      :disabled="disabled"
      data-cy="role-perm-switch"
      class="relative my-[9px] h-[26px] w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      :class="modelValue === true ? 'bg-brand' : 'bg-toggle-off'"
      @click="emit('update:modelValue', !(modelValue === true))"
    >
      <span class="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-surface shadow transition-transform" :class="modelValue === true ? 'translate-x-[18px]' : 'translate-x-0'" />
    </button>
  </div>

  <div v-else class="flex flex-col gap-2 border-t border-line-row py-3" data-cy="role-perm" :data-key="row.key">
    <div class="flex flex-col gap-0.5">
      <span :id="`${uid}-l`" class="text-[14.5px] font-semibold text-ink-900">{{ row.label }}</span>
      <span v-if="row.description" :id="`${uid}-d`" class="text-[13px] leading-snug text-ink-500">{{ row.description }}</span>
    </div>
    <div
      role="radiogroup"
      :aria-labelledby="`${uid}-l`"
      :aria-describedby="row.description ? `${uid}-d` : undefined"
      class="flex flex-wrap gap-0.5 rounded-ctl bg-chip-bg p-[3px] sm:flex-nowrap"
    >
      <button
        v-for="(o, i) in row.options"
        :key="o.value"
        type="button"
        role="radio"
        :aria-checked="modelValue === o.value"
        :tabindex="modelValue === o.value ? 0 : -1"
        :disabled="disabled"
        data-cy="role-perm-option"
        :data-value="o.value"
        class="min-h-11 flex-1 rounded-[9px] px-2 text-[13.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed"
        :class="modelValue === o.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'"
        @click="pick(o.value)"
        @keydown="onKey($event, i)"
      >
        {{ o.label }}
      </button>
    </div>
  </div>
</template>
