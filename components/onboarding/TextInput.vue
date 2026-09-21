<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string
    type?: string
    invalid?: boolean
    describedBy?: string
    autocomplete?: string
    placeholder?: string
    required?: boolean
    /** Locks the field while a submit is in flight, without dropping it from the tab order. */
    readonly?: boolean
  }>(),
  { type: 'text', invalid: false, describedBy: undefined, autocomplete: undefined, placeholder: undefined, required: false, readonly: false },
)

const model = defineModel<string>({ required: true })

const el = ref<HTMLInputElement | null>(null)
// The error state moves focus back to the offending field, which needs a
// handle on the real input from the page that owns the form.
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <input
    :id="id"
    ref="el"
    v-model="model"
    :type="type"
    :autocomplete="autocomplete"
    :placeholder="placeholder"
    :required="required"
    :readonly="readonly"
    :aria-invalid="invalid || undefined"
    :aria-describedby="describedBy"
    class="w-full rounded-ctl border bg-surface px-3 text-[15px] text-ink-900 outline-none transition-shadow placeholder:text-ink-faint lg:px-3 lg:text-[14px]"
    :class="[
      // 44px below lg: 38px is under the touch-target floor, and this flow
      // ships inside the Capacitor app as well as the browser.
      'h-11 lg:h-[38px]',
      readonly
        ? 'border-line bg-surface-subtle text-ink-muted'
        : invalid
          ? 'border-danger-text focus:shadow-focusDanger'
          : 'border-line-control focus:border-brand focus:shadow-focus',
      invalid && !readonly && 'shadow-focusDanger',
    ]"
  />
</template>
