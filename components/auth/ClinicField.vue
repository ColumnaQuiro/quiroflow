<script setup lang="ts">
// The clinic code on the patient sign-in and sign-up.
//
// It is only needed to link the account to the right record the first time
// (see composables/useClinicCode.ts), yet it used to be a blank field on
// every visit. Now, once the code is known -- from the clinic's own
// ?clinic= link, or from this browser's last visit -- and it resolves, it
// shows as the clinic itself with "Change", and only a patient with nothing
// known types it. A code that no longer resolves falls back to the field,
// so a typo stored once is never stuck behind the chip.
// `optional` is the sign-in: an account already linked to its record needs
// no code at all, and the portal middleware claims unscoped when none was
// given. Sign-up always needs it.
const props = defineProps<{ clinic: ReturnType<typeof useClinicCode>; readonly?: boolean; optional?: boolean }>()
const t = useT()

const editing = ref(true)
const input = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  props.clinic.prefill()
  if (!props.clinic.code.value) return
  try {
    await props.clinic.resolve()
    editing.value = false
  } catch {
    /* stays a field, with the stale code in it to correct */
  }
})

// Resolving on blur turns a typo into an obvious one: the clinic's name
// appears beside the field when the code is right, and doesn't when it
// isn't. Quiet on failure -- the patient is still filling the form in, and
// an error the moment focus leaves the field reads as an accusation.
async function onBlur() {
  props.clinic.clinicName.value = ''
  if (!props.clinic.code.value.trim()) return
  try {
    await props.clinic.resolve()
  } catch {
    /* reported on submit instead */
  }
}

async function change() {
  editing.value = true
  props.clinic.clinicName.value = ''
  await nextTick()
  input.value?.select()
}
</script>

<template>
  <div
    v-if="!editing"
    class="flex items-center gap-2.5 rounded-card border border-line bg-surface-subtle px-3 py-2.5"
    data-testid="clinic-chip"
  >
    <span
      aria-hidden="true"
      class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ctl bg-brand text-[12.5px] font-bold text-white"
    >{{ clinic.clinicName.value.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() }}</span>
    <div class="min-w-0 flex-1">
      <p class="truncate text-[14px] font-semibold text-ink-900">{{ clinic.clinicName.value }}</p>
      <p class="truncate text-[12px] text-ink-muted">{{ t('Clinic code', 'Código') }}: {{ clinic.code.value }}</p>
    </div>
    <button
      type="button"
      :disabled="readonly"
      class="rounded-ctlSm px-2 py-1 text-[13px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus"
      @click="change"
    >
      {{ t('Change', 'Cambiar') }}
    </button>
  </div>

  <OnboardingFormField
    v-else
    id="clinic-code"
    :label="t('Clinic code', 'Código de tu clínica')"
  >
    <div class="relative">
      <input
        id="clinic-code"
        ref="input"
        v-model="clinic.code.value"
        type="text"
        :required="!optional"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete="organization"
        :readonly="readonly"
        aria-describedby="clinic-code-hint"
        class="h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 outline-none transition-shadow focus:border-brand focus:shadow-focus lg:h-[38px] lg:text-[14px]"
        :class="clinic.clinicName.value && 'pr-[45%]'"
        @blur="onBlur"
      />
      <span
        v-if="clinic.clinicName.value"
        class="pointer-events-none absolute right-3 top-1/2 flex max-w-[42%] -translate-y-1/2 items-center gap-1 text-[12.5px] font-semibold text-success-text"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0">
          <path d="M3.5 8.4L6.6 11.4L12.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="truncate">{{ clinic.clinicName.value }}</span>
      </span>
    </div>
    <p id="clinic-code-hint" class="mt-[7px] text-[12.5px] leading-[1.45] text-ink-muted">
      {{
        optional
          ? t('Your clinic gives you this. Only needed the first time you sign in.', 'Te lo da tu clínica. Solo hace falta la primera vez que entras.')
          : t('Your clinic gives you this, or it comes in the link they sent you.', 'Te lo da tu clínica, o viene en el enlace que te envió.')
      }}
    </p>
  </OnboardingFormField>
</template>
