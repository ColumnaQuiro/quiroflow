<script setup lang="ts">
// Password, two-factor and other devices: the web Account page's Seguridad
// section, so a practitioner who only uses the app is not sent to a computer
// to change their password, turn two-factor on, or sign out the front-desk
// iPad they left open. Same Supabase calls as pages/account.vue.
const props = defineProps<{ accountId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const twoFactor = useTwoFactor()
const authPasswordError = useAuthPasswordError()
const { ask, notify } = useAppConfirm()
const appLock = useAppLock()
const faceIdShown = computed(() => appLock.native() && !!appLock.biometry.value)

// Password
const passwordOpen = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordError = ref('')
const passwordSaved = ref(false)
const passwordsMatch = computed(() => newPassword.value.length > 0 && newPassword.value === confirmPassword.value)
function closePassword() {
  passwordOpen.value = false
  newPassword.value = ''
  confirmPassword.value = ''
  passwordError.value = ''
}
async function changePassword() {
  passwordError.value = ''
  if (newPassword.value.length < 8) {
    passwordError.value = t('Password must be at least 8 characters.', 'La contraseña debe tener al menos 8 caracteres.')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = t('Passwords do not match.', 'Las contraseñas no coinciden.')
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  savingPassword.value = false
  if (error) {
    passwordError.value = authPasswordError(error)
    return
  }
  closePassword()
  passwordSaved.value = true
}

// Two-factor. null while it loads, so neither "On" nor "Off" flashes.
const twoFactorOn = ref<boolean | null>(null)
const clinicRequires = ref(false)
const settingUp = ref(false)
const removing = ref(false)
onMounted(async () => {
  const [on, { data }] = await Promise.all([
    twoFactor.isEnabled(),
    supabase.from('accounts').select('require_two_factor').eq('id', props.accountId).maybeSingle(),
  ])
  twoFactorOn.value = on
  clinicRequires.value = (data as { require_two_factor?: boolean } | null)?.require_two_factor === true
})
function onEnabled() {
  settingUp.value = false
  twoFactorOn.value = true
}
async function turnOff() {
  const ok = await ask({
    title: t('Turn off two-factor?', '¿Desactivar la verificación en dos pasos?'),
    body: t(
      "Signing in will only need your password. If someone gets hold of it, they'll be able to open your account and see patients' records.",
      'Para entrar bastará tu contraseña. Si alguien la consigue, podrá abrir tu cuenta y ver los datos de los pacientes.',
    ),
    confirmLabel: t('Turn off', 'Desactivar'),
    cancelLabel: t('Cancel', 'Cancelar'),
    danger: true,
  })
  if (!ok) return
  removing.value = true
  const failure = await twoFactor.remove()
  removing.value = false
  if (failure) {
    notify(t('Could not turn it off', 'No se ha podido desactivar'), failure)
    return
  }
  twoFactorOn.value = false
}

// Other devices: every session but this one.
const signingOutOthers = ref(false)
const signedOutOthers = ref(false)
async function signOutOthers() {
  signingOutOthers.value = true
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  signingOutOthers.value = false
  if (error) {
    notify(t('Could not sign them out', 'No se han podido cerrar'), error.message)
    return
  }
  signedOutOthers.value = true
}

const inputClass = 'h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[16px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const smallBtn = 'min-h-10 shrink-0 rounded-ctl border border-line-control px-3.5 text-[13.5px] font-medium text-ink-700 active:bg-surface-subtle'
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card px-4 py-3.5" data-cy="staff-security">
    <p class="text-[13.5px] font-medium text-ink-900">{{ t('Security', 'Seguridad') }}</p>

    <!-- Password -->
    <div class="mt-2 border-t border-line-row pt-3">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[14px] text-ink-900">{{ t('Password', 'Contraseña') }}</p>
          <p class="text-[12px] leading-snug" :class="passwordSaved ? 'text-success-text' : 'text-ink-muted'">
            {{ passwordSaved ? t('Changed.', 'Cambiada.') : t('At least 8 characters.', 'Al menos 8 caracteres.') }}
          </p>
        </div>
        <button v-if="!passwordOpen" type="button" :class="smallBtn" data-cy="security-password-open" @click="passwordOpen = true; passwordSaved = false">
          {{ t('Change…', 'Cambiar…') }}
        </button>
      </div>
      <form v-if="passwordOpen" class="mt-3 space-y-2.5" data-cy="security-password-form" @submit.prevent="changePassword">
        <label class="block text-[12.5px] font-medium text-ink-700">
          {{ t('New password', 'Nueva contraseña') }}
          <input v-model="newPassword" type="password" autocomplete="new-password" required minlength="8" :class="[inputClass, 'mt-1']" data-cy="security-new-password" />
        </label>
        <label class="block text-[12.5px] font-medium text-ink-700">
          {{ t('Repeat it', 'Repítela') }}
          <input v-model="confirmPassword" type="password" autocomplete="new-password" required minlength="8" :class="[inputClass, 'mt-1']" data-cy="security-confirm-password" />
        </label>
        <p v-if="confirmPassword && !passwordError" class="text-[12.5px]" :class="passwordsMatch ? 'text-success-text' : 'text-warning-text'">
          {{ passwordsMatch ? t('They match', 'Coinciden') : t("They don't match yet", 'Aún no coinciden') }}
        </p>
        <p v-if="passwordError" role="alert" class="text-[12.5px] text-danger-text">{{ passwordError }}</p>
        <div class="flex gap-2">
          <UiBtn type="submit" variant="primary" class="flex-1" :disabled="savingPassword" data-cy="security-password-submit">
            {{ savingPassword ? t('Saving…', 'Guardando…') : t('Change password', 'Cambiar contraseña') }}
          </UiBtn>
          <UiBtn type="button" variant="secondary" @click="closePassword">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </div>
      </form>
    </div>

    <!-- Face ID to open the app -->
    <div v-if="faceIdShown" class="mt-3 border-t border-line-row pt-2">
      <FaceIdSetting bare />
    </div>

    <!-- Two-factor -->
    <div class="mt-3 border-t border-line-row pt-3" data-cy="security-two-factor">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-[14px] text-ink-900">
            {{ t('Two-factor', 'Verificación en dos pasos') }}
            <UiPill v-if="twoFactorOn" tone="success">{{ t('On', 'Activada') }}</UiPill>
            <UiPill v-else-if="twoFactorOn === false" tone="neutral">{{ t('Off', 'Desactivada') }}</UiPill>
          </p>
          <p class="text-[12px] leading-snug text-ink-muted">
            <template v-if="twoFactorOn && clinicRequires">{{ t('Your clinic requires it, so it stays on.', 'Tu clínica la exige, así que permanece activada.') }}</template>
            <template v-else-if="twoFactorOn">{{ t('A code from your authenticator app at every sign-in.', 'Un código de tu app de autenticación en cada inicio de sesión.') }}</template>
            <template v-else>{{ t('A stolen password is not enough on its own.', 'Una contraseña robada no basta por sí sola.') }}</template>
          </p>
        </div>
        <button v-if="twoFactorOn && !clinicRequires" type="button" :class="smallBtn" :disabled="removing" data-cy="security-two-factor-off" @click="turnOff">
          {{ removing ? t('Turning off…', 'Desactivando…') : t('Turn off…', 'Desactivar…') }}
        </button>
        <button v-else-if="twoFactorOn === false && !settingUp" type="button" :class="smallBtn" data-cy="security-two-factor-on" @click="settingUp = true">
          {{ t('Set up', 'Configurar') }}
        </button>
      </div>
      <AuthTwoFactorEnroll v-if="settingUp" class="mt-3" @enabled="onEnabled" @cancel="settingUp = false" />
    </div>

    <!-- Other devices -->
    <div class="mt-3 flex items-center gap-3 border-t border-line-row pt-3">
      <div class="min-w-0 flex-1">
        <p class="text-[14px] text-ink-900">{{ t('Other devices', 'Otros dispositivos') }}</p>
        <p class="text-[12px] leading-snug text-ink-muted">{{ t('Sign out everywhere except this phone.', 'Cierra la sesión en todos menos en este.') }}</p>
      </div>
      <button
        type="button"
        class="min-h-10 shrink-0 rounded-ctl border px-3.5 text-[13.5px] font-medium"
        :class="signedOutOthers ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control text-ink-700 active:bg-surface-subtle'"
        :disabled="signingOutOthers || signedOutOthers"
        data-cy="security-sign-out-others"
        @click="signOutOthers"
      >
        {{ signedOutOthers ? t('Signed out', 'Cerradas') : signingOutOthers ? t('Signing out…', 'Cerrando…') : t('Sign out the others', 'Cerrar las demás') }}
      </button>
    </div>
  </div>
</template>
