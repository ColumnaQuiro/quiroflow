<script setup lang="ts">
// The Face ID switch, in the staff Profile (inside Seguridad) and the
// patient's Cuenta. Shown only on a device that has biometry set up.
defineProps<{ bare?: boolean }>()
const t = useT()
const lock = useAppLock()
const busy = ref(false)

async function flip() {
  busy.value = true
  if (lock.enabled.value) await lock.forget()
  else await lock.enable()
  busy.value = false
}
</script>

<template>
  <div v-if="lock.native() && lock.biometry.value" :class="bare ? '' : 'rounded-card border border-line bg-surface px-4 py-3.5 shadow-card'" data-cy="faceid-setting">
    <button type="button" role="switch" :aria-checked="lock.enabled.value" class="flex min-h-11 w-full items-center justify-between gap-3 text-left" :disabled="busy" @click="flip">
      <span class="min-w-0">
        <span class="block text-[14px] text-ink-900">{{ lock.label.value }}</span>
        <span class="block text-[12px] leading-snug text-ink-muted">{{ t('To open the app after two hours away, instead of your password.', 'Para abrir la app tras dos horas fuera, en lugar de la contraseña.') }}</span>
      </span>
      <span class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors" :class="lock.enabled.value ? 'bg-brand' : 'bg-line-control'">
        <span class="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-card transition-all" :class="lock.enabled.value ? 'left-[21px]' : 'left-[3px]'" />
      </span>
    </button>
  </div>
</template>
