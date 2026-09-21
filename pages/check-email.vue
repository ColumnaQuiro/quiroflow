<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const t = useT()

// Handed over through sessionStorage rather than the URL -- see signup.vue.
const email = ref('')
const resendIn = ref(60)
const resending = ref(false)
const resendError = ref('')
const resent = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  try {
    email.value = sessionStorage.getItem('signup_pending_email') ?? ''
  } catch {
    // Storage blocked; the copy falls back to a generic phrasing below.
  }
  timer = setInterval(() => {
    if (resendIn.value > 0) resendIn.value -= 1
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

// m:ss, so a full minute reads 1:00 rather than 0:60.
const countdown = computed(() => `${Math.floor(resendIn.value / 60)}:${String(resendIn.value % 60).padStart(2, '0')}`)

async function resend() {
  if (resendIn.value > 0 || resending.value || !email.value) return
  resending.value = true
  resendError.value = ''
  resent.value = false
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.value })
  resending.value = false
  if (error) {
    resendError.value = error.message
    return
  }
  resent.value = true
  resendIn.value = 60
}
</script>

<template>
  <OnboardingLayout>
    <template #stepper>
      <OnboardingStepper :current="1" :name-override="t('Confirming your email', 'Confirmando tu correo')" />
    </template>

    <template #heading>
      <div class="flex h-[46px] w-[46px] items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-[22px] w-[22px] text-brand-text">
          <rect x="3" y="5.5" width="18" height="13" rx="2.6" stroke="currentColor" stroke-width="1.6" />
          <path d="M3.8 7L12 12.8L20.2 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>

      <h1 class="mt-5 text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 lg:text-[30px]">
        {{ t('Check your email', 'Revisa tu correo') }}
      </h1>
      <p class="mt-3 text-[14.5px] leading-[1.6] text-ink-muted lg:text-[15px]">
        <template v-if="email">
          {{ t('We sent a confirmation link to', 'Hemos enviado un enlace de confirmación a') }}
          <span class="font-semibold text-ink-900">{{ email }}</span>.
        </template>
        <template v-else>
          {{ t('We sent a confirmation link to the address you just used.', 'Hemos enviado un enlace de confirmación a la dirección que acabas de usar.') }}
        </template>
        {{ t(`Open it and you'll land straight on step 2, practice setup.`, 'Ábrelo y llegarás directamente al paso 2, configurar tu consulta.') }}
      </p>
    </template>

    <template #form>
      <div class="mt-5 flex items-start gap-2.5 rounded-card border border-brand-tintBorder bg-brand-tint px-3.5 py-3 lg:mt-[22px]">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="mt-px h-4 w-4 shrink-0 text-brand-text">
          <circle cx="8" cy="8" r="5.9" stroke="currentColor" stroke-width="1.4" />
          <path d="M8 4.9V8.2L10.1 9.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p class="text-[13px] leading-[1.5] text-ink-700">
          {{ t('The link works once and expires in 60 minutes. Nothing is created until you open it.', 'El enlace funciona una sola vez y caduca en 60 minutos. No se crea nada hasta que lo abras.') }}
        </p>
      </div>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <OnboardingSecondaryButton :disabled="resendIn > 0 || resending || !email" @click="resend">
          {{ resending ? t('Sending…', 'Enviando…') : t('Resend link', 'Reenviar enlace') }}
        </OnboardingSecondaryButton>
        <span v-if="resendIn > 0" class="text-[13px] text-ink-muted" aria-live="off">
          {{ t(`You can resend in ${countdown}`, `Puedes reenviarlo en ${countdown}`) }}
        </span>
        <span v-else-if="resent" class="text-[13px] font-semibold text-success-text" role="status">
          {{ t('Sent again.', 'Enviado de nuevo.') }}
        </span>
      </div>
      <p v-if="resendError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ resendError }}</p>

      <div class="mt-5 flex flex-col gap-2 border-t border-line-divider pt-[18px]">
        <p class="text-[13.5px] leading-[1.55] text-ink-muted">
          {{ t('Nothing arrived? Check spam, or', '¿No ha llegado? Mira en spam, o') }}
          <NuxtLink to="/signup" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('use a different address', 'usa otra dirección') }}</NuxtLink>.
        </p>
        <p class="text-[13.5px] leading-[1.55] text-ink-muted">
          {{ t('Still stuck? Write to', '¿Sigues atascado? Escríbenos a') }}
          <a href="mailto:hola@quiroflow.com" class="font-semibold text-brand-text hover:text-brand-hover">hola@quiroflow.com</a>.
        </p>
      </div>
    </template>

    <template #preview>
      <OnboardingPreviewEmail :email="email || t('your address', 'tu dirección')" />
    </template>
  </OnboardingLayout>
</template>
