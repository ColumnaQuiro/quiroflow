<script setup lang="ts">
import { COUNTRIES, countryByCode } from '~/utils/countries'
import { looksLikePhoneNumber, toE164Loose } from '~/utils/phone'
import { previewSlug, type ImportSource } from '~/components/onboarding/previewFixtures'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { preference: themePreference, setPreference: setThemePreference } = useTheme()
const { preference: langPreference, setPreference: setLangPreference } = useLang()

const ownerName = ref('')
const ownerNameError = ref('')
const nameInput = ref<{ focus: () => void } | null>(null)
// A number QuiroFlow can reach the person signing up on. Stored on the
// account (accounts.owner_phone) and sent in the new-account email; patients
// never see it.
const ownerPhone = ref('')
const ownerPhoneError = ref('')
const phoneInput = ref<{ focus: () => void } | null>(null)
// Whether the owner treats patients. Yes for most practices signing up -- a
// chiropractor who owns the clinic -- and yes is what puts them in the
// calendar and on the booking page straight away. A practice run by a
// manager says no, and keeps the plan's included seat for the first
// practitioner they invite.
const ownerIsPractitioner = ref(true)
const accountName = ref('')
const accountNameError = ref('')
const accountInput = ref<{ focus: () => void } | null>(null)
const clinicName = ref('')
const clinicNameError = ref('')
const clinicInput = ref<{ focus: () => void } | null>(null)
// The country the first clinic is in (clinics.country). It also becomes the
// account's default dial code -- the manual "add a number" field, the
// new-patient forms, the public booking page and an import's fallback all
// read that -- which is what stops a clinic outside Spain from silently
// storing Spanish numbers. This page used to ask for the dial code itself
// ("Phone numbers are mostly from"); a clinic whose patients mostly phone
// from abroad changes it in Settings -> Messages.
//
// Guessed from the browser's own region so most practices never touch it;
// anything unrecognised lands on ES, which is what it was before.
const country = ref('ES')

// Guessed on the client only: this page server-renders, and `navigator`
// doesn't exist there. Starting at ES and correcting on mount keeps the
// server and client markup identical.
onMounted(() => {
  try {
    const region = new Intl.Locale(navigator.language || 'es-ES').maximize().region
    if (region && COUNTRIES.some((c) => c.code === region)) country.value = region
  } catch {
    // An exotic or missing navigator.language just leaves the default.
  }
})
const error = ref('')
const loading = ref(false)
// 'form' -> 'preferences' -> 'import' -> 'launch': a couple of quick
// preference picks, where the clinic's records are coming from, and a brief
// "you're all set" moment instead of dropping straight into the dashboard
// the instant the account exists -- matches signup.vue's step 1, this page
// covering steps 2-5 of the same flow.
const step = ref<'form' | 'preferences' | 'import' | 'launch'>('form')

const stepNumber = computed(() => ({ form: 2, preferences: 3, import: 4, launch: 5 })[step.value])

// Optional, and nothing is imported here: the import needs the clinic's
// PracticeHub key or Quirocitas login, and runs for minutes, so it belongs
// on Settings -> Import, not inside a sign-up. What this step does is make
// the question visible before "all set", point Launch at the right source,
// and tell the dashboard's first steps (components/dashboard/FirstSteps.vue)
// whether to offer the import at all -- through the same per-account key
// that card reads.
const importSource = ref<ImportSource | null>(null)
function chooseImport() {
  try {
    localStorage.setItem(`first-steps-import:${store.accountId}`, importSource.value ?? 'none')
  } catch {
    // Without it the dashboard simply offers the import as optional.
  }
  step.value = 'launch'
}

const IMPORT_OPTIONS = computed<{ key: ImportSource; title: string; body: string }[]>(() => [
  {
    key: 'practicehub',
    title: 'PracticeHub',
    body: t('Patients, visits, bonos, invoices, notes and files', 'Pacientes, citas, bonos, facturas, notas y archivos'),
  },
  {
    key: 'quirocitas',
    title: 'Quirocitas',
    body: t('Patients, visits and invoices', 'Pacientes, citas y facturas'),
  },
  {
    key: 'other',
    title: t('Another program', 'Otro programa'),
    body: t('Patients from a CSV file', 'Pacientes desde un archivo CSV'),
  },
  {
    key: 'none',
    title: t('Starting fresh', 'Empiezo de cero'),
    body: t('Nothing to bring across', 'No hay nada que traer'),
  },
])

// Moving focus to the new heading is what tells a screen reader the step
// changed -- without it, focus stays on a button that no longer exists and
// the reader is left at the top of the document with no announcement.
const headingEl = ref<HTMLElement | null>(null)
watch(step, async () => {
  await nextTick()
  headingEl.value?.focus()
})

// True once the account exists -- which, on this page, only happens after
// step 2 has been submitted once and the person has come Back from step 3.
//
// It matters because create_account_with_owner refuses a second account
// outright ("User already belongs to an account"), by design. Submitting step
// 2 again therefore has to edit what is already there rather than call the
// RPC, or Back would lead straight into an error nobody can clear.
const alreadyCreated = computed(() => !!store.accountId)

async function createPractice() {
  const { error: rpcError } = await supabase.rpc('create_account_with_owner', {
    p_account_name: accountName.value,
    p_clinic_name: clinicName.value,
    p_owner_name: ownerName.value,
    p_referred_by_slug: localStorage.getItem('signup_referred_by') || null,
    p_default_phone_country: country.value,
    p_owner_is_practitioner: ownerIsPractitioner.value,
    p_clinic_country: country.value,
    p_owner_phone: ownerPhoneE164(),
  })
  if (rpcError) return rpcError.message
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
  // Also best-effort, and for the same reason: nobody watches a table for
  // new rows, so this is what turns an account appearing into something a
  // human finds out about. It carries the attribution signup.vue parked,
  // because this is the last moment anything still knows it.
  try {
    let attribution: unknown = null
    const stored = localStorage.getItem('signup_attribution')
    if (stored) attribution = JSON.parse(stored)
    await useStaffFetch('/api/internal/notify-new-account', { method: 'POST', body: { attribution } })
    localStorage.removeItem('signup_attribution')
  } catch {
    // ignore
  }
  return null
}

// Stored as E.164 when it parses, so whoever reads the new-account email can
// dial it from anywhere; as typed when it does not, rather than lost.
// toE164Loose returns WhatsApp's bare digits, so the + is put back here.
function ownerPhoneE164() {
  const typed = ownerPhone.value.trim()
  const e164 = toE164Loose(typed, country.value)
  return e164 ? `+${e164}` : typed
}

// The same answers, written to the rows the RPC created. Deliberately
// not a re-run of the RPC and not a delete-and-recreate: the clinic's slug
// and its booking subdomain were registered under the original name, and
// tearing those down to rename a practice mid-onboarding would cost more
// than it is worth. Renaming here leaves the slug alone, exactly as renaming
// a clinic from Settings does.
async function updatePractice() {
  const clinicId = store.clinics[0]?.id
  const { error: accountError } = await supabase
    .from('accounts')
    .update({ name: accountName.value, default_phone_country: country.value, owner_phone: ownerPhoneE164() })
    .eq('id', store.accountId!)
  if (accountError) return accountError.message

  if (clinicId) {
    const { error: clinicError } = await supabase.from('clinics').update({ name: clinicName.value, country: country.value }).eq('id', clinicId)
    if (clinicError) return clinicError.message
  }

  const { error: memberError } = await supabase
    .from('team_members')
    .update({ full_name: ownerName.value, is_practitioner: ownerIsPractitioner.value })
    .eq('id', store.teamMember!.id)
  if (memberError) return memberError.message

  store.reset()
  await store.load()
  return null
}

// What the database said, kept for support but shown under a sentence a
// clinic owner can act on -- not as the message itself.
const errorDetail = ref('')

async function onSubmit() {
  if (loading.value) return
  error.value = ''
  errorDetail.value = ''
  ownerNameError.value = ''
  ownerPhoneError.value = ''
  accountNameError.value = ''
  clinicNameError.value = ''
  // The form is novalidate, so an empty name used to go through: the RPC
  // falls back to the email for the owner, but a practice called "" gets a
  // booking address built from nothing and an "all set" screen that reads
  // " is ready, with  (Spain)". A number nobody can dial is worse than none,
  // because it looks like we have one.
  if (!ownerName.value.trim()) ownerNameError.value = t('Enter your name.', 'Escribe tu nombre.')
  if (!looksLikePhoneNumber(ownerPhone.value.trim(), country.value)) {
    ownerPhoneError.value = t('Enter a phone number we can reach you on.', 'Escribe un teléfono en el que podamos localizarte.')
  }
  if (!accountName.value.trim()) accountNameError.value = t('Name your practice.', 'Ponle nombre a tu consulta.')
  if (!clinicName.value.trim()) clinicNameError.value = t('Name the clinic, or the town it is in.', 'Pon nombre a la clínica, o el pueblo o ciudad donde está.')
  const firstInvalid = ownerNameError.value
    ? nameInput
    : ownerPhoneError.value
      ? phoneInput
      : accountNameError.value
        ? accountInput
        : clinicNameError.value
          ? clinicInput
          : null
  if (firstInvalid) {
    firstInvalid.value?.focus()
    return
  }
  loading.value = true
  const message = alreadyCreated.value ? await updatePractice() : await createPractice()
  loading.value = false
  if (message) {
    error.value = alreadyCreated.value
      ? t('Your changes weren’t saved. Try again.', 'No se han guardado los cambios. Inténtalo de nuevo.')
      : t('The practice wasn’t created. Try again.', 'No se ha creado la consulta. Inténtalo de nuevo.')
    errorDetail.value = message
    return
  }
  step.value = 'preferences'
}

// Step 2's Back is the only one that leaves the page. The auth user already
// exists by the time this screen renders, so there is no in-app "step 1" to
// return to -- going back to it means becoming signed-out again. Nothing is
// lost: no account row exists yet, and signing in with the same address
// lands straight back here.
async function backToSignup() {
  await supabase.auth.signOut({ scope: 'local' })
  await navigateTo('/signup')
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

// The country's name in the interface language, not COUNTRIES' English one.
const countryName = computed(() => {
  try {
    return new Intl.DisplayNames([langPreference.value], { type: 'region' }).of(country.value) ?? countryByCode(country.value).name
  } catch {
    return countryByCode(country.value).name
  }
})

const importing = computed(() => !!importSource.value && importSource.value !== 'none')
const importSourceName = computed(() =>
  importSource.value === 'practicehub' ? 'PracticeHub' : importSource.value === 'quirocitas' ? 'Quirocitas' : t('a CSV file', 'un archivo CSV'),
)

const launchSummary = computed(() =>
  importing.value
    ? t(
        `${accountName.value} is ready, with ${clinicName.value} (${countryName.value}) as its first clinic. Next, bring your records across from ${importSourceName.value}.`,
        `${accountName.value} ya está en marcha, con ${clinicName.value} (${countryName.value}) como primera clínica. Ahora, trae tus datos desde ${importSourceName.value}.`,
      )
    : t(
        `${accountName.value} is ready, with ${clinicName.value} (${countryName.value}) as its first clinic. Here is what is waiting inside.`,
        `${accountName.value} ya está en marcha, con ${clinicName.value} (${countryName.value}) como primera clínica. Esto es lo que te espera dentro.`,
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
      'Sent 24 hours ahead, unless you choose otherwise. When a patient taps Confirmar, the calendar marks the visit confirmed.',
      'Se envían 24 horas antes, salvo que elijas otro plazo. Cuando el paciente pulsa Confirmar, la agenda marca la cita como confirmada.',
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
])
</script>

<template>
  <OnboardingLayout :align="step === 'form' || step === 'launch' ? 'start' : 'center'">
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
            'The practice is your business; a clinic is a place where you see patients. Add the one you work from today, and any others later.',
            'La consulta es tu negocio; una clínica, cada sitio donde atiendes. Añade la clínica en la que trabajas hoy, y las demás más adelante.',
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
            'Two quick choices about how QuiroFlow looks to you. Everyone on your team picks their own.',
            'Dos decisiones rápidas sobre cómo ves QuiroFlow. Cada persona de tu equipo elige las suyas.',
          )
        }}
      </p>
    </template>

    <template v-else-if="step === 'import'" #heading>
      <h1 ref="headingEl" tabindex="-1" class="text-[25px] font-semibold leading-[1.18] tracking-tightTitle text-ink-900 outline-none lg:text-[30px]">
        {{ t('Coming from other software?', '¿Vienes de otro programa?') }}
      </h1>
      <p class="mt-2 text-[14.5px] leading-[1.55] text-ink-muted lg:mt-[11px] lg:text-[15px]">
        {{
          t(
            'Bring your patients and their history with you, or start empty. Optional, and you can change your mind later.',
            'Trae a tus pacientes y su historial, o empieza de cero. Es opcional, y puedes cambiar de idea más tarde.',
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
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <OnboardingFormField id="owner-name" :label="t('Your name', 'Tu nombre')" :error="ownerNameError">
            <OnboardingTextInput
              id="owner-name"
              ref="nameInput"
              v-model="ownerName"
              autocomplete="name"
              required
              :readonly="loading"
              :invalid="!!ownerNameError"
              :described-by="ownerNameError ? 'owner-name-error' : undefined"
              placeholder="Alba Esteve"
            />
          </OnboardingFormField>
          <OnboardingFormField id="owner-phone" :label="t('Your phone', 'Tu teléfono')" :error="ownerPhoneError">
            <OnboardingTextInput
              id="owner-phone"
              ref="phoneInput"
              v-model="ownerPhone"
              type="tel"
              autocomplete="tel"
              required
              :readonly="loading"
              :invalid="!!ownerPhoneError"
              :described-by="ownerPhoneError ? 'owner-phone-error' : undefined"
              placeholder="600 00 00 00"
              data-test="owner-phone"
            />
          </OnboardingFormField>
        </div>
        <p class="-mt-2 text-[12.5px] leading-[1.45] text-ink-muted">
          {{ t('Only QuiroFlow uses your phone, to help you get set up. Patients never see it.', 'Tu teléfono solo lo usa QuiroFlow, para ayudarte a empezar. Tus pacientes no lo ven.') }}
        </p>

        <div>
          <p class="mb-1.5 text-[14px] font-medium text-ink-700">
            {{ t('Do you see patients yourself?', '¿Atiendes pacientes tú?') }}
          </p>
          <OnboardingTileGroup :label="t('Do you see patients yourself?', '¿Atiendes pacientes tú?')" :columns="2">
            <OnboardingSelectTile
              v-for="opt in [true, false]"
              :key="String(opt)"
              layout="inline"
              :selected="ownerIsPractitioner === opt"
              :data-test="opt ? 'owner-treats-yes' : 'owner-treats-no'"
              @click="ownerIsPractitioner = opt"
            >
              <span class="min-w-0 flex-1">
                <span class="block text-[13.5px] font-semibold text-ink-700">
                  {{ opt ? t('Yes, I treat patients', 'Sí, atiendo pacientes') : t('No, I run the practice', 'No, gestiono la consulta') }}
                </span>
                <span class="mt-0.5 block text-[12px] text-ink-muted">
                  {{ opt ? t('You get a column in the calendar', 'Tendrás tu columna en la agenda') : t('Invite the practitioners later', 'Invita a los profesionales después') }}
                </span>
              </span>
              <OnboardingTileCheck :selected="ownerIsPractitioner === opt" />
            </OnboardingSelectTile>
          </OnboardingTileGroup>
        </div>

        <OnboardingFormField
          id="account-name"
          :label="t('Practice name', 'Nombre de la consulta')"
          :description="t('It also becomes the address of your booking page.', 'También será la dirección de tu página de reservas.')"
          :error="accountNameError"
        >
          <OnboardingTextInput
            id="account-name"
            ref="accountInput"
            v-model="accountName"
            required
            :readonly="loading"
            :invalid="!!accountNameError"
            :described-by="[accountNameError && 'account-name-error', 'account-name-description'].filter(Boolean).join(' ')"
            :placeholder="t('Your practice name', 'Nombre de tu consulta')"
          />
        </OnboardingFormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <OnboardingFormField id="clinic-name" :label="t('First clinic', 'Primera clínica')" :error="clinicNameError">
            <OnboardingTextInput
              id="clinic-name"
              ref="clinicInput"
              v-model="clinicName"
              required
              :readonly="loading"
              :invalid="!!clinicNameError"
              :described-by="clinicNameError ? 'clinic-name-error' : undefined"
              placeholder="Valencia"
            />
          </OnboardingFormField>
          <OnboardingFormField id="clinic-country" :label="t('Country', 'País')">
            <OnboardingCountrySelect id="clinic-country" v-model="country" :dial="false" data-test="clinic-country" />
          </OnboardingFormField>
        </div>

        <!-- The booking URL the right panel shows, folded inline where there is
             no right panel to show it in. -->
        <div class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2.5 lg:hidden">
          <p class="text-[11.5px] font-semibold text-brand-text">{{ t('Your booking page', 'Tu página de reservas') }}</p>
          <p class="mt-1 truncate text-[13px] leading-[1.4] text-ink-700">
            <strong class="font-semibold">{{ previewSlug(accountName) || t('your-practice', 'tu-consulta') }}</strong>.app.quiroflow.com
          </p>
        </div>

        <div v-if="error" role="alert" class="text-[12.5px] leading-[1.45] text-danger-text">
          <p>
            {{ error }}
            {{ t('If it keeps happening, write to', 'Si vuelve a pasar, escríbenos a') }}
            <a href="mailto:hola@quiroflow.com" class="font-semibold underline">hola@quiroflow.com</a>.
          </p>
          <p v-if="errorDetail" class="mt-1 text-ink-muted">{{ t('Details:', 'Detalle:') }} {{ errorDetail }}</p>
        </div>

        <div class="mt-1.5 flex gap-2.5">
          <OnboardingSecondaryButton :disabled="loading" @click="backToSignup">
            {{ t('Back', 'Atrás') }}
          </OnboardingSecondaryButton>
          <OnboardingPrimaryButton class="flex-1" :loading="loading" :loading-label="t('Setting up…', 'Configurando…')">
            {{ alreadyCreated ? t('Save and continue', 'Guardar y continuar') : t('Create practice', 'Crear consulta') }}
          </OnboardingPrimaryButton>
        </div>
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
                  {{ opt === 'en' ? 'Your menus and screens' : 'Tus menús y pantallas' }}
                </span>
              </span>
              <OnboardingTileCheck :selected="langPreference === opt" />
            </OnboardingSelectTile>
          </OnboardingTileGroup>
        </div>

        <p class="text-[12.5px] leading-[1.5] text-ink-muted">
          {{
            t(
              'Change either one later in Account Settings, in the menu under your name. Patients get messages in their own language, set on their record.',
              'Puedes cambiarlas luego en Ajustes de la cuenta, en el menú con tu nombre. Los pacientes reciben los mensajes en su propio idioma, el de su ficha.',
            )
          }}
        </p>

        <div class="flex gap-2.5">
          <OnboardingSecondaryButton @click="step = 'form'">
            {{ t('Back', 'Atrás') }}
          </OnboardingSecondaryButton>
          <OnboardingPrimaryButton class="flex-1" type="button" @click="step = 'import'">
            {{ t('Continue', 'Continuar') }}
          </OnboardingPrimaryButton>
        </div>
      </div>

      <!-- Step 4 -->
      <div v-else-if="step === 'import'" class="mt-5 flex flex-col gap-[22px] lg:mt-[30px]">
        <OnboardingTileGroup :label="t('Where are your records now?', '¿Dónde están ahora tus datos?')" :columns="2">
          <OnboardingSelectTile
            v-for="opt in IMPORT_OPTIONS"
            :key="opt.key"
            layout="inline"
            :selected="importSource === opt.key"
            :data-test="`import-source-${opt.key}`"
            @click="importSource = opt.key"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-[13.5px] font-semibold text-ink-700">{{ opt.title }}</span>
              <span class="mt-0.5 block text-[12px] text-ink-muted">{{ opt.body }}</span>
            </span>
            <OnboardingTileCheck :selected="importSource === opt.key" />
          </OnboardingSelectTile>
        </OnboardingTileGroup>

        <p class="text-[12.5px] leading-[1.5] text-ink-muted">
          {{
            t(
              'Nothing is imported yet. When you are ready, run it from Settings → Import. Then match each practitioner it brings in to someone on your team, so their visits land in the right calendar column.',
              'Todavía no se importa nada. Cuando quieras, hazlo desde Ajustes → Importar. Después asigna cada profesional importado a alguien de tu equipo, para que sus visitas caigan en su columna de la agenda.',
            )
          }}
        </p>

        <div class="flex gap-2.5">
          <OnboardingSecondaryButton @click="step = 'preferences'">
            {{ t('Back', 'Atrás') }}
          </OnboardingSecondaryButton>
          <OnboardingPrimaryButton class="flex-1" type="button" data-test="import-continue" @click="chooseImport">
            {{ importSource ? t('Continue', 'Continuar') : t('Skip for now', 'Saltar por ahora') }}
          </OnboardingPrimaryButton>
        </div>
      </div>

      <!-- Step 5 -->
      <div v-else class="mt-4 lg:mt-5">
        <!-- One list rather than a 2x2 grid of cards: the grid made the step
             taller than a laptop screen, so the button that finishes
             onboarding sat below the fold. Support is a line under the
             button for the same reason. -->
        <ul class="divide-y divide-line-divider rounded-card border border-line bg-surface-subtle">
          <li
            v-for="card in LAUNCH_CARDS"
            :key="card.key"
            class="flex gap-3 px-3.5 py-2.5"
          >
            <div class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-ctl border border-brand-tintBorder bg-brand-tint">
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
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-semibold text-ink-900">{{ card.title }}</p>
              <p class="mt-0.5 text-[13px] leading-[1.45] text-ink-muted">{{ card.body }}</p>
            </div>
          </li>
        </ul>

        <template v-if="importing">
          <OnboardingPrimaryButton class="mt-5" type="button" size="lg" data-test="launch-import" @click="navigateTo(`/settings/import?source=${importSource}`)">
            {{ t(`Import from ${importSourceName}`, `Importar desde ${importSourceName}`) }}
          </OnboardingPrimaryButton>
          <p class="mt-2.5 text-center text-[12.5px] text-ink-muted">
            {{ t('Or', 'O') }}
            <NuxtLink to="/dashboard" class="font-semibold text-brand-text hover:text-brand-hover">{{ t('go to the dashboard first', 've antes al panel') }}</NuxtLink>{{
              t(': importing stays on your list of first steps there.', ': la importación seguirá en tu lista de primeros pasos.')
            }}
          </p>
        </template>
        <template v-else>
          <OnboardingPrimaryButton class="mt-5" type="button" size="lg" @click="navigateTo('/dashboard')">
            {{ t('Get started', 'Empezar') }}
          </OnboardingPrimaryButton>
          <p class="mt-2.5 text-center text-[12.5px] text-ink-muted">
            {{ t('Three short steps there take you to your first booked visit.', 'Allí, tres pasos cortos te llevan a tu primera visita reservada.') }}
          </p>
        </template>
        <!-- Was a fourth card; a line costs a fifth of the height. -->
        <p class="mt-1.5 text-center text-[12.5px] text-ink-muted">
          {{ t('Need a hand? Write to', '¿Necesitas ayuda? Escríbenos a') }}
          <a href="mailto:hola@quiroflow.com" class="font-semibold text-brand-text hover:text-brand-hover">hola@quiroflow.com</a>
          {{ t('— a real person answers.', '— te responde una persona.') }}
        </p>
      </div>
    </template>

    <template #preview>
      <OnboardingPreviewPractice
        v-if="step === 'form'"
        :practice="accountName"
        :location="clinicName"
        :country-code="country"
      />
      <OnboardingPreviewReminders
        v-else-if="step === 'preferences'"
        :practice="accountName"
        :theme="themePreference"
        :language="langPreference"
      />
      <OnboardingPreviewImport v-else-if="step === 'import'" :source="importSource" />
      <OnboardingPreviewPatient v-else />
    </template>
  </OnboardingLayout>
</template>
