<script setup lang="ts">
// Taking the iPad back from reception mode: Face ID (Touch ID) when the
// device has it, the reception code, or -- the code forgotten -- the
// password of the team member who handed it over. Any one of them unlocks
// and returns to that patient's record, with the forms just signed on it.
const props = defineProps<{ staffEmail: string; patientId: string }>()
const emit = defineEmits<{ close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const reception = useReceptionLock()

const kind = ref<'faceId' | 'touchId' | 'other' | null>(null)
const code = ref('')
const password = ref('')
const usePassword = ref(false)
const error = ref('')
const checking = ref(false)

onMounted(async () => {
  kind.value = await reception.biometry()
  if (kind.value) tryBiometry()
})

async function leave() {
  reception.clearFailures()
  reception.unlock()
  await navigateTo(`/patients/${props.patientId}`, { replace: true })
}

async function tryBiometry() {
  error.value = ''
  if (await reception.confirmWithBiometry(t('Leave reception mode', 'Salir del modo recepción'))) await leave()
}

// A four-digit code is guessable by a patient with time on their hands, so
// every fifth wrong one locks the code out, for longer each time
// (useReceptionLock.recordFailure).
async function tryCode() {
  if (checking.value) return
  if (Date.now() < reception.attempts().waitUntil) {
    error.value = t('Too many tries. Wait a moment.', 'Demasiados intentos. Espera un momento.')
    return
  }
  checking.value = true
  error.value = ''
  const ok = await reception.checkCode(code.value)
  checking.value = false
  if (ok) return leave()
  code.value = ''
  reception.recordFailure()
  error.value = t('That is not the code.', 'Ese no es el código.')
}
watch(code, (v) => {
  if (v.length === 6) tryCode()
})

async function tryPassword() {
  if (checking.value || !props.staffEmail) return
  checking.value = true
  error.value = ''
  const { error: e } = await supabase.auth.signInWithPassword({ email: props.staffEmail, password: password.value })
  checking.value = false
  if (!e) return leave()
  password.value = ''
  error.value = t('Wrong password.', 'Contraseña incorrecta.')
}

const biometryLabel = computed(() => (kind.value === 'faceId' ? 'Face ID' : kind.value === 'touchId' ? 'Touch ID' : t('Biometrics', 'Biometría')))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 px-4" data-cy="reception-exit-sheet" @click.self="emit('close')">
    <div class="flex w-full max-w-[380px] flex-col gap-3 rounded-[18px] bg-surface p-5 shadow-popover" role="dialog" aria-modal="true" :aria-label="t('Leave reception mode', 'Salir del modo recepción')">
      <p class="text-[17px] font-semibold text-ink-900">{{ t('For the clinic team', 'Para el equipo de la clínica') }}</p>
      <p class="-mt-1.5 text-[13px] text-ink-muted">{{ t('Leaving reception mode returns to the clinic’s app.', 'Al salir del modo recepción vuelve la app de la clínica.') }}</p>

      <button v-if="kind" type="button" class="flex h-11 items-center justify-center gap-2 rounded-card bg-brand text-[15px] font-semibold text-white" data-cy="reception-exit-biometry" @click="tryBiometry">
        {{ t(`Use ${biometryLabel}`, `Usar ${biometryLabel}`) }}
      </button>

      <form v-if="!usePassword" class="flex flex-col gap-2" @submit.prevent="tryCode">
        <label class="text-[12.5px] font-medium text-ink-muted" for="reception-exit-code">{{ t('Reception code', 'Código de recepción') }}</label>
        <input
          id="reception-exit-code"
          v-model="code"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          maxlength="6"
          class="h-12 rounded-ctl border border-line-control bg-surface px-3 text-center text-[22px] tracking-[.4em] focus:border-brand focus:outline-none"
          data-cy="reception-exit-code"
        />
        <button type="submit" class="flex h-11 items-center justify-center rounded-card border border-line-control text-[14.5px] font-semibold text-ink-900 disabled:opacity-50" :disabled="code.length < 4 || checking" data-cy="reception-exit-code-submit">
          {{ t('Unlock', 'Desbloquear') }}
        </button>
        <button v-if="staffEmail" type="button" class="text-[12.5px] text-brand-text" @click="usePassword = true; error = ''">{{ t('Forgot the code?', '¿Has olvidado el código?') }}</button>
      </form>

      <form v-else class="flex flex-col gap-2" @submit.prevent="tryPassword">
        <label class="text-[12.5px] font-medium text-ink-muted" for="reception-exit-password">{{ t(`Password for ${staffEmail}`, `Contraseña de ${staffEmail}`) }}</label>
        <input id="reception-exit-password" v-model="password" type="password" autocomplete="current-password" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] focus:border-brand focus:outline-none" data-cy="reception-exit-password" />
        <button type="submit" class="flex h-11 items-center justify-center rounded-card border border-line-control text-[14.5px] font-semibold text-ink-900 disabled:opacity-50" :disabled="!password || checking">{{ t('Unlock', 'Desbloquear') }}</button>
        <button type="button" class="text-[12.5px] text-brand-text" @click="usePassword = false; error = ''">{{ t('Use the code', 'Usar el código') }}</button>
      </form>

      <p v-if="error" role="alert" class="text-center text-[13px] text-danger-text" data-cy="reception-exit-error">{{ error }}</p>
      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Back to the forms', 'Volver a los formularios') }}</button>
    </div>
  </div>
</template>
