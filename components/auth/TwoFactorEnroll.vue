<script setup lang="ts">
import type { TwoFactorEnrollment } from '../../composables/useTwoFactor'

// Setting up an authenticator app: QR code (or the key typed in by hand),
// then one code from the app to prove it works. Used from Account Settings,
// from /two-factor when the clinic requires it, and from the mobile app --
// where the QR is on the same phone that would have to scan it, so the
// otpauth:// link that hands the key straight to the authenticator matters
// more than the picture.
const props = defineProps<{ required?: boolean }>()
const emit = defineEmits<{ enabled: []; cancel: [] }>()

const t = useT()
const { startEnroll, confirmEnroll, cancelEnroll } = useTwoFactor()

const enrollment = ref<TwoFactorEnrollment | null>(null)
const code = ref('')
const error = ref('')
const starting = ref(true)
const confirming = ref(false)
const copied = ref(false)

onMounted(async () => {
  const result = await startEnroll()
  starting.value = false
  enrollment.value = result.enrollment
  if (result.error) error.value = result.error
})

// Four characters at a time: 32 characters in one run is where people mistype.
const groupedSecret = computed(() => enrollment.value?.secret.match(/.{1,4}/g)?.join(' ') ?? '')

async function copySecret() {
  if (!enrollment.value) return
  await navigator.clipboard?.writeText(enrollment.value.secret)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function submit() {
  if (!enrollment.value || confirming.value) return
  error.value = ''
  confirming.value = true
  const failure = await confirmEnroll(enrollment.value.factorId, code.value)
  confirming.value = false
  if (failure) {
    error.value = twoFactorErrorText(failure, t)
    code.value = ''
    return
  }
  emit('enabled')
}

async function cancel() {
  if (enrollment.value) await cancelEnroll(enrollment.value.factorId)
  emit('cancel')
}
</script>

<template>
  <div class="space-y-4 text-[13px] text-ink-700">
    <p v-if="starting" class="text-ink-muted">{{ t('Preparing…', 'Preparando…') }}</p>

    <template v-else-if="enrollment">
      <ol class="list-decimal space-y-1 pl-5 text-ink-600">
        <li>{{ t('Install an authenticator app on your phone -- Google Authenticator, Microsoft Authenticator, 1Password, or the iPhone Passwords app all work.', 'Instala una app de autenticación en tu móvil: Google Authenticator, Microsoft Authenticator, 1Password o la app Contraseñas del iPhone sirven.') }}</li>
        <li>{{ t('Scan this QR code with it, or type the key below.', 'Escanea este código QR con ella, o escribe la clave de abajo.') }}</li>
        <li>{{ t('Enter the 6-digit code the app shows.', 'Introduce el código de 6 dígitos que muestra la app.') }}</li>
      </ol>

      <div class="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <img :src="enrollment.qrCode" alt="" class="h-40 w-40 shrink-0 rounded-ctl border border-line bg-white p-2" />
        <div class="min-w-0 space-y-2">
          <p class="text-[12px] text-ink-muted2">{{ t("Can't scan it? Enter this key:", '¿No puedes escanearlo? Introduce esta clave:') }}</p>
          <p data-testid="two-factor-secret" :data-secret="enrollment.secret" class="break-all font-mono text-[13px] text-ink-900">{{ groupedSecret }}</p>
          <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="copySecret">
            {{ copied ? t('Copied ✓', 'Copiado ✓') : t('Copy key', 'Copiar clave') }}
          </button>
          <a :href="enrollment.uri" class="block text-[12.5px] font-medium text-brand-text hover:text-brand-hover sm:hidden">
            {{ t('Add to authenticator app on this phone', 'Añadir a la app de autenticación de este móvil') }}
          </a>
        </div>
      </div>

      <form class="space-y-3" @submit.prevent="submit">
        <div>
          <label class="block text-sm font-medium text-ink-700" for="two-factor-enroll-code">{{ t('Code from the app', 'Código de la app') }}</label>
          <input
            id="two-factor-enroll-code"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            placeholder="123456"
            required
            class="mt-1 w-full max-w-[200px] rounded-ctl border border-line-control px-3 py-2 text-center font-mono text-lg tracking-[.3em] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
        <div class="flex items-center gap-3">
          <UiBtn type="submit" variant="primary" :disabled="confirming">
            {{ confirming ? t('Checking…', 'Comprobando…') : t('Turn on two-factor', 'Activar verificación en dos pasos') }}
          </UiBtn>
          <UiBtn v-if="!props.required" type="button" variant="secondary" @click="cancel">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </div>
      </form>
    </template>

    <p v-else class="text-sm text-danger-text">{{ error }}</p>
  </div>
</template>
