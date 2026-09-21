<script setup lang="ts">
import { COUNTRIES, countryByCode } from '~/utils/countries'
import { previewSlug } from '~/components/onboarding/previewFixtures'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { preference: themePreference, setPreference: setThemePreference } = useTheme()
const { preference: langPreference, setPreference: setLangPreference } = useLang()

const ownerName = ref('')
const accountName = ref('')
const clinicName = ref('')
// The country every phone number defaults to from here on -- the manual
// "add a number" field, the new-patient forms, the public booking page and
// an import's fallback all read it. Asking once, here, is what stops a
// clinic outside Spain from silently storing Spanish numbers.
//
// Guessed from the browser's own region so most practices never touch it;
// anything unrecognised lands on ES, which is what it was before.
const phoneCountry = ref('ES')

// Guessed on the client only: this page server-renders, and `navigator`
// doesn't exist there. Starting at ES and correcting on mount keeps the
// server and client markup identical.
onMounted(() => {
  try {
    const region = new Intl.Locale(navigator.language || 'es-ES').maximize().region
    if (region && COUNTRIES.some((c) => c.code === region)) phoneCountry.value = region
  } catch {
    // An exotic or missing navigator.language just leaves the default.
  }
})
const error = ref('')
const loading = ref(false)
// 'form' -> 'preferences' -> 'launch': a couple of quick preference picks
// and a brief "you're all set" moment instead of dropping straight into the
// dashboard the instant the account exists -- matches signup.vue's step 1,
// this page covering steps 2-4 of the same flow.
const step = ref<'form' | 'preferences' | 'launch'>('form')

const stepNumber = computed(() => ({ form: 2, preferences: 3, launch: 4 })[step.value])

// Moving focus to the new heading is what tells a screen reader the step
// changed -- without it, focus stays on a button that no longer exists and
// the reader is left at the top of the document with no announcement.
const headingEl = ref<HTMLElement | null>(null)
watch(step, async () => {
  await nextTick()
  headingEl.value?.focus()
})

async function onSubmit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  const { error: rpcError } = await supabase.rpc('create_account_with_owner', {
    p_account_name: accountName.value,
    p_clinic_name: clinicName.value,
    p_owner_name: ownerName.value,
    p_referred_by_slug: localStorage.getItem('signup_referred_by') || null,
    p_default_phone_country: phoneCountry.value,
  })
  loading.value = false
  if (rpcError) {
    error.value = rpcError.message
    return
  }
  localStorage.removeItem('signup_referred_by')
  store.reset()
  await store.load()
  // Best-effort -- if this fails (e.g. Netlify not configured), the clinic
  // still works fine, its booking subdomain just needs adding manually.
  try {
    await useStaffFetch('/api/internal/register-clinic-subdomain', { method: 'POST' })
  } catch {
    // ignore
  }
  step.value = 'preferences'
}

// Same read-then-write pattern as pages/account.vue's Appearance section --
// applies instantly (useTheme/useLang) and persists to the row store.load()
// just populated.
async function chooseTheme(value: 'light' | 'dark' | 'system') {
  setThemePreference(value)
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', store.teamMember!.id)
}
async function chooseLanguage(value: 'en' | 'es') {
  setLangPreference(value)
  await supabase.from('team_members').update({ language_preference: value }).eq('id', store.teamMember!.id)
}

const dialCode = computed(() => countryByCode(phoneCountry.value).dial || '—')
const languageName = computed(() => (langPreference.value === 'es' ? t('Spanish', 'español') : t('English', 'inglés')))

const launchSummary = computed(() =>
  t(
    `${accountName.value} is live in ${clinicName.value}, in ${languageName.value}, with ${dialCode.value} as the default dial code. Four things are waiting for you inside.`,
    `${accountName.value} ya está en marcha en ${clinicName.value}, en ${languageName.value}, con ${dialCode.value} como prefijo por defecto. Dentro te esperan cuatro cosas.`,
  ),
)

const LAUNCH_CARDS = computed(() => [
  {
    key: 'calendar',
    title: t('Calendar & online booking', 'Agenda y reservas online'),
    body: t(
      'Week views per clinic and room, plus a booking page patients fill in themselves.',
      'Vista semanal por clínica y sala, y una página donde los pacientes reservan solos.',
    ),
  },
  {
    key: 'reminders',
    title: t('WhatsApp & email reminders', 'Recordatorios por WhatsApp y email'),
    body: t(
      'Sent 24 hours ahead. When a patient replies CONFIRMAR, the calendar updates itself.',
      'Se envían 24 horas antes. Cuando el paciente responde CONFIRMAR, la agenda se actualiza sola.',
    ),
  },
  {
    key: 'invoicing',
    title: t('Invoicing & payments', 'Facturación y cobros'),
    body: t(
      'Issue an invoice in euros and take the card payment through Stripe, in one step.',
      'Emite la factura en euros y cobra con tarjeta vía Stripe, en un solo paso.',
    ),
  },
  {
    key: 'support',
    title: t('Need a hand?', '¿Necesitas ayuda?'),
    body: '',
  },
])
</script>

<template>
  <OnboardingLayout :align="step === 'form' ? 'start' : 'center'">
    <template #stepper>
      <OnboardingStepper :current="stepNumber" />
    </template>

    <!-- ============ Step 2 — practice setup ============ -->
    <template v-if="step === 'form'" #heading>
      <h1 ref="headingEl" tabindex="-1" class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 outline-none lg:text-[30px]">
        {{ t('Set up your practice', 'Configura tu consulta') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:mt-[11px] lg:text-[15px]">
        {{
          t(
            'Name the practice and add the clinic you work from today. Madrid, Alicante and the rest can come later.',
            'Pon nombre a tu consulta y añade la clínica en la que trabajas hoy. Madrid, Alicante y las demás pueden esperar.',
          )
        }}
      </p>
    </template>

    <template v-else-if="step === 'preferences'" #heading>
      <h1 ref="headingEl" tabindex="-1" class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 outline-none lg:text-[30px]">
        {{ t('Make QuiroFlow yours', 'Haz tuyo QuiroFlow') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:mt-[11px] lg:text-[15px]">
        {{
          t(
            'Two quick choices. Language also sets what your patients read in reminders.',
            'Dos decisiones rápidas. El idioma también define lo que leen tus pacientes en los recordatorios.',
          )
        }}
      </p>
    </template>

    <template v-else #heading>
      <div class="flex items-center gap-2.5">
        <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-success-border bg-success-bg">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-3.5 w-3.5 text-success-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <h1 ref="headingEl" tabindex="-1" class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 outline-none lg:text-[30px]">
          {{ t(`You're all set`, 'Todo listo') }}
        </h1>
      </div>
      <p class="mt-3 text-[14.5px] leading-[1.55] text-ink-muted lg:text-[15px]">{{ launchSummary }}</p>
    </template>

    <template #form>
      <!-- Step 2 -->
      <form v-if="step === 'form'" class="mt-5 flex flex-col gap-4 lg:mt-7" novalidate @submit.prevent="onSubmit">
        <OnboardingFormField id="owner-name" :label="t('Your name', 'Tu nombre')">
          <OnboardingTextInput id="owner-name" v-model="ownerName" autocomplete="name" required :readonly="loading" placeholder="Lea Guido" />
        </OnboardingFormField>

        <OnboardingFormField id="account-name" :label="t('Practice name', 'Nombre de la consulta')">
          <OnboardingTextInput id="account-name" v-model="accountName" required :readonly="loading" placeholder="ColumnaQuiro" />
        </OnboardingFormField>

        <OnboardingFormField id="clinic-name" :label="t('First clinic location', 'Primera clínica')">
          <OnboardingTextInput id="clinic-name" v-model="clinicName" required :readonly="loading" placeholder="Valencia" />
        </OnboardingFormField>

        <!-- The booking URL the right panel shows, folded inline where there is
             no right panel to show it in. -->
        <div class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2.5 lg:hidden">
          <p class="text-[11.5px] font-semibold text-brand-text">{{ t('Your booking page', 'Tu página de reservas') }}</p>
          <p class="mt-1 truncate text-[13px] leading-[1.4] text-ink-700">
            quiroflow.app/<strong class="font-semibold">{{ previewSlug(accountName) || t('practice', 'consulta') }}</strong
            >/<strong class="font-semibold">{{ previewSlug(clinicName) || t('clinic', 'clinica') }}</strong>
          </p>
        </div>

        <OnboardingFormField
          id="phone-country"
          :label="t('Phone numbers are mostly from', 'Los números de teléfono son sobre todo de')"
          :description="t(`Used when a patient's number doesn't say. You can change it later.`, 'Se usa cuando el número del paciente no lo indica. Puedes cambiarlo más tarde.')"
        >
          <OnboardingCountrySelect id="phone-country" v-model="phoneCountry" described-by="phone-country-description" />
        </OnboardingFormField>

        <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>

        <OnboardingPrimaryButton class="mt-1.5" :loading="loading" :loading-label="t('Setting up…', 'Configurando…')">
          {{ t('Create practice', 'Crear consulta') }}
        </OnboardingPrimaryButton>
      </form>

      <!-- Step 3 -->
      <div v-else-if="step === 'preferences'" class="mt-5 flex flex-col gap-[22px] lg:mt-[30px]">
        <div>
          <p class="mb-2.5 text-[14px] font-semibold text-ink-700">{{ t('Appearance', 'Apariencia') }}</p>
          <OnboardingTileGroup :label="t('Appearance', 'Apariencia')" :columns="3">
            <OnboardingSelectTile
              v-for="opt in (['light', 'dark', 'system'] as const)"
              :key="opt"
              layout="stacked"
              :selected="themePreference === opt"
              @click="chooseTheme(opt)"
            >
              <OnboardingThemeThumbnail :variant="opt" />
              <div class="flex w-full items-center gap-1.5">
                <span class="text-[13.5px] font-semibold text-ink-700">
                  {{ opt === 'light' ? t('Light', 'Clara') : opt === 'dark' ? t('Dark', 'Oscura') : t('System', 'Sistema') }}
                </span>
                <span class="flex-1" />
                <OnboardingTileCheck :selected="themePreference === opt" />
              </div>
            </OnboardingSelectTile>
          </OnboardingTileGroup>
        </div>

        <div>
          <p class="mb-2.5 text-[14px] font-semibold text-ink-700">{{ t('Language', 'Idioma') }}</p>
          <OnboardingTileGroup :label="t('Language', 'Idioma')" :columns="2">
            <OnboardingSelectTile
              v-for="opt in (['en', 'es'] as const)"
              :key="opt"
              layout="inline"
              :selected="langPreference === opt"
              @click="chooseLanguage(opt)"
            >
              <OnboardingCountryFlag :code="opt === 'en' ? 'GB' : 'ES'" :width="22" />
              <span class="min-w-0 flex-1">
                <span class="block text-[13.5px] font-semibold text-ink-700">{{ opt === 'en' ? 'English' : 'Español' }}</span>
                <span class="mt-0.5 block text-[12px] text-ink-muted">
                  {{ opt === 'en' ? 'Interface and patient messages' : 'Interfaz y mensajes a pacientes' }}
                </span>
              </span>
              <OnboardingTileCheck :selected="langPreference === opt" />
            </OnboardingSelectTile>
          </OnboardingTileGroup>
        </div>

        <p class="text-[12.5px] leading-[1.5] text-ink-muted">
          {{ t('You can always change these later from Account.', 'Siempre puedes cambiarlo luego desde Cuenta.') }}
        </p>

        <OnboardingPrimaryButton type="button" @click="step = 'launch'">
          {{ t('Continue', 'Continuar') }}
        </OnboardingPrimaryButton>
      </div>

      <!-- Step 4 -->
      <div v-else class="mt-5 lg:mt-7">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div
            v-for="card in LAUNCH_CARDS"
            :key="card.key"
            class="rounded-card border border-line bg-surface-subtle p-3.5"
          >
            <div class="flex h-[30px] w-[30px] items-center justify-center rounded-ctl border border-brand-tintBorder bg-brand-tint">
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-4 w-4 text-brand-text">
                <template v-if="card.key === 'calendar'">
                  <rect x="2.5" y="3.8" width="13" height="11.2" rx="2.2" stroke="currentColor" stroke-width="1.4" />
                  <path d="M2.5 7.4H15.5" stroke="currentColor" stroke-width="1.4" />
                  <path d="M6.2 2.4V5M11.8 2.4V5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </template>
                <template v-else-if="card.key === 'reminders'">
                  <path d="M15.2 8.6c0 3.1-2.8 5.6-6.2 5.6-0.8 0-1.6-0.1-2.3-0.4l-3.4 1.1 1.1-2.8A5.3 5.3 0 0 1 2.8 8.6C2.8 5.5 5.6 3 9 3s6.2 2.5 6.2 5.6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                  <path d="M6.6 8.6h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </template>
                <template v-else-if="card.key === 'invoicing'">
                  <path d="M4 2.8h10v12.4l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                  <path d="M11 6.4H7.6a1.7 1.7 0 0 0 0 3.4h1.6a1.7 1.7 0 0 1 0 3.4H6.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                </template>
                <template v-else>
                  <circle cx="9" cy="9" r="6.2" stroke="currentColor" stroke-width="1.4" />
                  <circle cx="9" cy="9" r="2.4" stroke="currentColor" stroke-width="1.4" />
                  <path d="M4.6 4.6l2.7 2.7M10.7 10.7l2.7 2.7M13.4 4.6l-2.7 2.7M7.3 10.7l-2.7 2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                </template>
              </svg>
            </div>
            <p class="mt-[11px] text-[14px] font-semibold text-ink-900">{{ card.title }}</p>
            <p v-if="card.body" class="mt-[5px] text-[13px] leading-[1.5] text-ink-muted">{{ card.body }}</p>
            <p v-else class="mt-[5px] text-[13px] leading-[1.5] text-ink-muted">
              {{ t('Write to', 'Escríbenos a') }}
              <a href="mailto:hola@quiroflow.com" class="font-semibold text-brand-text hover:text-brand-hover">hola@quiroflow.com</a>
              {{ t('— a real person answers, in English or Spanish.', '— te responde una persona, en inglés o en español.') }}
            </p>
          </div>
        </div>

        <OnboardingPrimaryButton class="mt-6" type="button" size="lg" @click="navigateTo('/dashboard')">
          {{ t('Get started', 'Empezar') }}
        </OnboardingPrimaryButton>
        <p class="mt-[11px] text-center text-[12.5px] text-ink-muted">
          {{ t(`Opens your ${clinicName} calendar.`, `Abre la agenda de ${clinicName}.`) }}
        </p>
      </div>
    </template>

    <template #preview>
      <OnboardingPreviewPractice
        v-if="step === 'form'"
        :practice="accountName"
        :location="clinicName"
        :country-code="phoneCountry"
      />
      <OnboardingPreviewReminders
        v-else-if="step === 'preferences'"
        :practice="accountName"
        :theme="themePreference"
        :language="langPreference"
      />
      <OnboardingPreviewPatient v-else />
    </template>
  </OnboardingLayout>
</template>
