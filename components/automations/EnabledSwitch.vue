<script setup lang="ts">
// An automation is on or off: a switch that looks like one, with the state
// written beside it. It replaced a "Pausada" pill in the builder's header
// that was the switch without looking like anything to click.
//
// When it cannot be switched on (something missing, a lead automation without
// Growth) it is disabled and `reason` says why -- read by a screen reader
// with the switch, and shown on hover. Pages that have room show it in words
// too (the list row, the builder's "Why?"), since hover is no help on a tablet.

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    on: boolean
    /** What the label says when on/off is not the whole story ("Draft", "Paused · no Growth"). */
    label?: string
    disabled?: boolean
    reason?: string
    /** On hover when it can be switched: what on or off means here. */
    hint?: string
    busy?: boolean
  }>(),
  { label: '', disabled: false, reason: '', hint: '', busy: false },
)
const emit = defineEmits<{ toggle: [] }>()
const t = useT()
// `class` sizes the switch with its label; data-test and the like belong on the button.
const attrs = useAttrs()
const buttonAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
// The same on the server and the client: these ids are rendered on the server.
const id = `enabled${useId()}`

const text = computed(() => props.label || (props.on ? t('Active', 'Activa') : t('Paused', 'Pausada')))
function flip() {
  if (!props.disabled && !props.busy) emit('toggle')
}
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-2" :class="attrs.class as string | undefined">
    <button
      type="button"
      role="switch"
      v-bind="buttonAttrs"
      :aria-checked="on"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="disabled && reason ? `${id}-reason` : undefined"
      :aria-busy="busy || undefined"
      :disabled="disabled"
      :title="disabled && reason ? reason : hint || (on ? t('Click to pause it', 'Pulsa para pausarla') : t('Click to switch it on', 'Pulsa para activarla'))"
      class="relative h-[26px] w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 touch:my-[9px]"
      :class="[on ? 'bg-brand' : 'bg-toggle-off', busy ? 'cursor-progress' : '']"
      @click="flip"
    >
      <span class="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-transform" :class="on ? 'translate-x-[18px]' : 'translate-x-0'" />
    </button>
    <span :id="`${id}-label`" class="whitespace-nowrap text-[12.5px] font-semibold" :class="on ? 'text-success-text' : 'text-ink-muted'" data-test="enabled-label">{{ text }}</span>
    <span v-if="disabled && reason" :id="`${id}-reason`" class="sr-only">{{ reason }}</span>
  </span>
</template>
