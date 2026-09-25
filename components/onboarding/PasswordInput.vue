<script setup lang="ts">
withDefaults(defineProps<{ id: string; describedBy?: string; readonly?: boolean }>(), {
  describedBy: undefined,
  readonly: false,
})

const model = defineModel<string>({ required: true })

const t = useT()
const visible = ref(false)

// Advisory only. The rule that actually gates submission is Supabase's own
// six-character minimum, enforced by the input's `minlength` -- a meter that
// blocked a valid password would be inventing a policy the backend does not
// have, and locking people out of their own signup.
const score = computed(() => {
  const value = model.value
  if (!value) return 0
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length
  let s = 1
  if (value.length >= 10) s = 2
  if (value.length >= 14) s = 3
  if (classes >= 3 && value.length >= 10) s = Math.min(4, s + 1)
  if (value.length >= 16) s = 4
  return s
})

const TONES = [
  { label: () => t('Weak', 'Débil'), text: 'text-danger-text', fill: 'bg-danger-text', muted: 'bg-danger-border' },
  { label: () => t('Fair', 'Aceptable'), text: 'text-warning-text', fill: 'bg-warning-text', muted: 'bg-warning-border' },
  { label: () => t('Good', 'Buena'), text: 'text-success-text', fill: 'bg-success-text', muted: 'bg-success-border' },
  { label: () => t('Strong', 'Fuerte'), text: 'text-success-text', fill: 'bg-success-text', muted: 'bg-success-border' },
]

const tone = computed(() => TONES[Math.max(0, score.value - 1)])
</script>

<template>
  <div>
    <div class="relative">
      <input
        :id="id"
        v-model="model"
        :type="visible ? 'text' : 'password'"
        autocomplete="new-password"
        required
        minlength="6"
        :readonly="readonly"
        :aria-describedby="[describedBy, `${id}-strength`].filter(Boolean).join(' ') || undefined"
        class="h-9 touch:h-11 w-full rounded-ctl border bg-surface pl-3 pr-[74px] text-[15px] text-ink-900 outline-none transition-shadow lg:h-[38px] lg:text-[14px]"
        :class="
          readonly
            ? 'border-line bg-surface-subtle text-ink-muted'
            : 'border-line-control focus:border-brand focus:shadow-focus'
        "
      />
      <button
        type="button"
        :aria-pressed="visible"
        :aria-label="visible ? t('Hide password', 'Ocultar contraseña') : t('Show password', 'Mostrar contraseña')"
        :disabled="readonly"
        class="absolute right-[5px] top-1/2 -translate-y-1/2 rounded-ctlSm px-2.5 text-[12.5px] font-semibold outline-none focus-visible:shadow-focus disabled:cursor-not-allowed"
        :class="[
          'h-9 lg:h-7',
          readonly ? 'text-ink-faint' : 'text-brand-text hover:bg-surface-page',
          visible && !readonly && 'bg-surface-page',
        ]"
        @click="visible = !visible"
      >
        {{ visible ? t('Hide', 'Ocultar') : t('Show', 'Mostrar') }}
      </button>
    </div>

    <div class="mt-[9px] flex items-center gap-2.5">
      <div class="flex flex-1 gap-1">
        <div
          v-for="n in 4"
          :key="n"
          class="h-[3px] flex-1 rounded-sm"
          :class="n <= score ? (readonly ? tone.muted : tone.fill) : readonly ? 'bg-line-divider' : 'bg-line'"
        />
      </div>
      <span
        :id="`${id}-strength`"
        aria-live="polite"
        class="text-[12px] font-semibold"
        :class="readonly ? 'text-ink-faint' : tone.text"
      >{{ score ? tone.label() : '' }}</span>
    </div>

    <p v-if="!readonly" class="mt-[7px] text-[12.5px] leading-[1.45] text-ink-muted">
      {{
        t(
          "At least 6 characters. A phrase you'll remember beats a short password you won't.",
          'Mínimo 6 caracteres. Una frase que recuerdes vale más que una contraseña corta que no.',
        )
      }}
    </p>
  </div>
</template>
