<script setup lang="ts">
// An in-app confirmation, in place of window.confirm(). confirm() cannot be
// translated, styled or put in dark mode, and it states the question with
// none of the consequences -- which is the part a person needs before an
// irreversible click.
//
// `confirmWord`: when set, the confirm button stays disabled until that word
// is typed (case-insensitive). For the one or two actions on the app that
// cannot be undone by the person taking them.
//
// `disabled`: the confirm button stays disabled until the caller says the
// form in the slot is complete -- for a dialog that asks for a choice rather
// than only a yes.
//
// Focus is trapped inside while open and Escape cancels (useFocusTrap), and
// the safe button takes focus first, so Enter on arrival does nothing harmful.

const props = withDefaults(
  defineProps<{
    title: string
    confirmLabel: string
    cancelLabel: string
    tone?: 'danger' | 'neutral'
    confirmWord?: string | null
    busy?: boolean
    disabled?: boolean
  }>(),
  { tone: 'neutral', confirmWord: null, busy: false, disabled: false },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const t = useT()

const panel = ref<HTMLElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
useFocusTrap(panel, () => emit('cancel'))
onMounted(() => cancelBtn.value?.focus())

const typed = ref('')
const locked = computed(() => props.disabled || (!!props.confirmWord && typed.value.trim().toUpperCase() !== props.confirmWord.toUpperCase()))
const titleId = `confirm-${Math.random().toString(36).slice(2, 9)}`

function confirm() {
  if (locked.value || props.busy) return
  emit('confirm')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center" @click.self="emit('cancel')">
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      data-cy="confirm-dialog"
      class="w-full max-w-[520px] rounded-card border border-line bg-surface shadow-popover"
    >
      <div class="flex flex-col gap-3 px-6 pb-2 pt-6">
        <h2 :id="titleId" class="text-[18px] font-bold" :class="tone === 'danger' ? 'text-danger-text' : 'text-ink-900'">{{ title }}</h2>
        <slot />
        <label v-if="confirmWord" class="mt-1 flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t(`Type ${confirmWord} to confirm`, `Escribe ${confirmWord} para confirmar`) }}
          <input
            v-model="typed"
            data-cy="confirm-dialog-word"
            autocomplete="off"
            autocapitalize="characters"
            class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] tracking-wide text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @keydown.enter.prevent="confirm"
          />
        </label>
      </div>
      <div class="flex flex-wrap justify-end gap-2 px-6 pb-6 pt-4">
        <button
          ref="cancelBtn"
          type="button"
          data-cy="confirm-dialog-cancel"
          class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle"
          @click="emit('cancel')"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          data-cy="confirm-dialog-confirm"
          :disabled="locked || busy"
          class="h-11 rounded-ctl px-4 text-[14px] font-bold disabled:cursor-not-allowed disabled:bg-chip-bg disabled:text-ink-faint"
          :class="tone === 'danger' ? 'bg-danger-text text-surface' : 'bg-ink-900 text-surface'"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
