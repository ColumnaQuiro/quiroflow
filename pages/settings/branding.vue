<script setup lang="ts">
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { shrinkImageForUpload } from '~/utils/imageShrink'
import { IMMUTABLE_CACHE_SECONDS } from '~/utils/storageCache'
import { formatEur } from '~/utils/billing'
import { CLINIC_BRAND_PRESETS, clinicBrandDeclarations, clinicBrandPalette, normalizeBrandColor } from '~/utils/clinicBrandPalette'

// The clinic's own look in the patient app: its logo, the name it goes by
// and one colour (20261111063546_patient_app_branding.sql).
//
// One colour on purpose. The app has sixteen brand shades across its two
// themes and utils/clinicBrandPalette.ts derives all of them, adjusting each
// until it can be read -- so the preview below is honest about what a patient
// gets, in light and in dark, whatever is picked.
//
// Anyone can set it up and see the preview. Patients get it only while the
// account has the add-on, which the status line at the top says; the database
// decides (get_clinic_branding), not this page.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const loading = ref(true)
const saving = ref(false)
const active = ref(false)
// The add-on's monthly price, for the line that says it is a paid extra.
const price = ref<number | null>(null)

const name = ref('')
const color = ref('')
const logoPath = ref<string | null>(null)
// What the database holds, to write only what changed: the settings guard
// asks for the permission of every column an update changes.
const saved = ref({ name: '', color: '', logoPath: null as string | null })
// The first clinic's logo, which the app falls back on with none set here.
const fallbackLogoPath = ref<string | null>(null)

function publicLogo(path: string | null) {
  return path ? supabase.storage.from('clinic-logos').getPublicUrl(path).data.publicUrl : null
}
const logoUrl = computed(() => publicLogo(logoPath.value ?? fallbackLogoPath.value))

async function load() {
  loading.value = true
  const [{ data: account }, { data: branding }, { data: addon }] = await Promise.all([
    supabase.from('accounts').select('patient_app_brand_name, patient_app_brand_color, patient_app_brand_logo_path').eq('id', store.accountId!).maybeSingle(),
    // Asked as a preview: it answers with what patients WOULD see, and
    // `active` says whether they do.
    supabase.rpc('get_clinic_branding', { p_slug: store.accountSlug, p_preview: true }),
    supabase.from('addons').select('monthly_price_cents').eq('id', 'branding').maybeSingle(),
  ])
  price.value = addon?.monthly_price_cents ?? null
  name.value = account?.patient_app_brand_name ?? ''
  color.value = account?.patient_app_brand_color ?? ''
  logoPath.value = account?.patient_app_brand_logo_path ?? null
  saved.value = { name: name.value, color: color.value, logoPath: logoPath.value }
  const raw = branding as { active?: boolean; logo_path?: string | null } | null
  active.value = raw?.active === true
  fallbackLogoPath.value = logoPath.value ? null : (raw?.logo_path ?? null)
  loading.value = false
}
onMounted(load)

// --- colour ---

const colorText = ref('')
watch(color, (c) => { colorText.value = c }, { immediate: true })
const colorInvalid = computed(() => colorText.value.trim() !== '' && !normalizeBrandColor(colorText.value))
function onColorTyped() {
  const hex = normalizeBrandColor(colorText.value)
  if (hex) color.value = hex
  else if (colorText.value.trim() === '') color.value = ''
}
function pickColor(hex: string) {
  color.value = normalizeBrandColor(hex) ?? ''
}

// --- logo ---

const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const original = input.files?.[0]
  input.value = ''
  if (!original) return
  uploading.value = true
  // The app, the lock screen and the wallet pass all draw this small.
  const file = await shrinkImageForUpload(original, 'logo')
  const path = `${store.accountId}/brand/${Date.now()}-${sanitizeStorageFilename(file.name)}`
  const { error } = await supabase.storage.from('clinic-logos').upload(path, file, { cacheControl: IMMUTABLE_CACHE_SECONDS })
  uploading.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  logoPath.value = path
}

// --- save ---

const dirty = computed(() => name.value.trim() !== saved.value.name || color.value !== saved.value.color || logoPath.value !== saved.value.logoPath)

async function save() {
  if (colorInvalid.value) {
    showToast(t('That is not a colour. Use six digits, like #0f766e.', 'Eso no es un color. Usa seis dígitos, como #0f766e.'), 'error')
    return
  }
  const changes: { patient_app_brand_name?: string | null; patient_app_brand_color?: string | null; patient_app_brand_logo_path?: string | null } = {}
  if (name.value.trim() !== saved.value.name) changes.patient_app_brand_name = name.value.trim() || null
  if (color.value !== saved.value.color) changes.patient_app_brand_color = color.value || null
  if (logoPath.value !== saved.value.logoPath) changes.patient_app_brand_logo_path = logoPath.value
  if (!Object.keys(changes).length) return
  saving.value = true
  // Read back: an update a policy refuses is not an error, it changes nothing.
  const { data, error } = await supabase.from('accounts').update(changes).eq('id', store.accountId!).select('id')
  saving.value = false
  if (error || !data?.length) {
    showToast(error?.message ?? t('Not saved.', 'No se ha guardado.'), 'error')
    return
  }
  showToast(t('Saved.', 'Guardado.'), 'success')
  await load()
}

// --- preview ---

// The two themes side by side, whatever theme this screen is in, so the page
// surfaces are written out here rather than read from the document. The same
// values as assets/css/theme.css; the brand shades come from the palette.
const SURFACES = {
  light: { page: '247 248 250', surface: '255 255 255', line: '232 233 237', ink: '21 23 30', muted: '104 109 125' },
  dark: { page: '15 16 20', surface: '24 25 31', line: '42 44 54', ink: '245 246 248', muted: '148 152 166' },
} as const

const PREVIEW_THEMES = Object.keys(SURFACES) as (keyof typeof SURFACES)[]
const QUIROFLOW_COLOR = CLINIC_BRAND_PRESETS[0]!
const palette = computed(() => clinicBrandPalette(color.value || QUIROFLOW_COLOR)!)
function previewStyle(theme: 'light' | 'dark') {
  const s = SURFACES[theme]
  return `${clinicBrandDeclarations(palette.value[theme])} --pv-page: ${s.page}; --pv-surface: ${s.surface}; --pv-line: ${s.line}; --pv-ink: ${s.ink}; --pv-muted: ${s.muted};`
}
const shownName = computed(() => name.value.trim() || store.accountName || t('Your clinic', 'Tu clínica'))
const initials = computed(() => shownName.value.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase())
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Brand', 'Marca')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[980px] flex-1 flex-col gap-4">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Your logo, your name and your colour in the patient app, in place of QuiroFlow\'s. The app keeps its name and icon in the stores and on the phone\'s home screen.', 'Tu logo, tu nombre y tu color en la app de pacientes, en lugar de los de QuiroFlow. La app conserva su nombre y su icono en las tiendas y en la pantalla de inicio del teléfono.') }}
          </p>

          <UiSkeleton v-if="loading" class="h-[72px] rounded-card" />
          <div
            v-else
            class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border px-[18px] py-3.5"
            :class="active ? 'border-success-border bg-success-bg' : 'border-brand-tintBorder bg-brand-tint'"
            data-cy="branding-status"
          >
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-semibold text-ink-900">
                {{ active ? t('Your patients see this look', 'Tus pacientes ven esta marca') : t('Preview only: your patients still see QuiroFlow', 'Solo vista previa: tus pacientes siguen viendo QuiroFlow') }}
              </p>
              <p class="mt-0.5 text-[13px] leading-snug text-ink-muted">
                {{
                  active
                    ? t('A change here reaches each phone the next time the app is opened.', 'Un cambio aquí llega a cada teléfono la próxima vez que se abre la app.')
                    : price === null
                      ? t('Your own look is a paid extra. Set it up and check the preview here, then switch it on.', 'La marca propia es un extra de pago. Prepárala y revisa la vista previa aquí, y después actívala.')
                      : t(`Your own look is a paid extra: ${formatEur(price)} a month + IVA. Set it up and check the preview here, then switch it on.`, `La marca propia es un extra de pago: ${formatEur(price)} al mes + IVA. Prepárala y revisa la vista previa aquí, y después actívala.`)
                }}
              </p>
            </div>
            <template v-if="!active">
              <NuxtLink v-if="store.isOwner" to="/subscription?addon=branding" class="inline-flex h-9 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11" data-cy="branding-activate">
                {{ t('Switch it on', 'Activar') }}
              </NuxtLink>
              <span v-else class="text-[12.5px] text-ink-muted" data-cy="branding-ask-owner">{{ t('The account owner can switch it on from Subscription.', 'El propietario de la cuenta puede activarla desde Suscripción.') }}</span>
            </template>
          </div>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section aria-labelledby="h-brand" class="rounded-card border border-line bg-surface px-[18px] py-4">
              <h2 id="h-brand" class="text-[16px] font-bold text-ink-900">{{ t('Your look', 'Tu marca') }}</h2>

              <div class="mt-4 flex flex-col gap-2">
                <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Logo', 'Logo') }}</span>
                <div class="flex items-center gap-3">
                  <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-surface-subtle">
                    <img v-if="logoUrl" :src="logoUrl" class="h-full w-full object-contain" :alt="t('Clinic logo', 'Logo de la clínica')" data-cy="branding-logo" />
                    <span v-else class="text-[11px] text-ink-faint">{{ t('None', 'Ninguno') }}</span>
                  </div>
                  <UiBtn :disabled="uploading" data-cy="branding-logo-upload" @click="fileInput?.click()">
                    {{ uploading ? t('Uploading…', 'Subiendo…') : logoPath ? t('Replace', 'Sustituir') : t('Upload', 'Subir') }}
                  </UiBtn>
                  <UiBtn v-if="logoPath" variant="ghost" data-cy="branding-logo-remove" @click="logoPath = null">{{ t('Remove', 'Quitar') }}</UiBtn>
                  <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-cy="branding-logo-input" @change="onFileChosen" />
                </div>
                <p class="text-[12.5px] leading-snug text-ink-muted">
                  {{
                    logoPath
                      ? t('Square works best. A PNG also goes on the Apple Wallet pass.', 'Mejor cuadrado. Un PNG se usa también en el pase de Apple Wallet.')
                      : fallbackLogoPath
                        ? t('Using your clinic\'s logo. Upload another one to use it in the app only.', 'Se usa el logo de tu clínica. Sube otro para usarlo solo en la app.')
                        : t('Square works best. A PNG also goes on the Apple Wallet pass. With none, patients see your initials.', 'Mejor cuadrado. Un PNG se usa también en el pase de Apple Wallet. Sin logo, los pacientes ven tus iniciales.')
                  }}
                </p>
              </div>

              <label class="mt-5 flex flex-col gap-2">
                <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Name in the app', 'Nombre en la app') }}</span>
                <input
                  v-model="name"
                  maxlength="40"
                  :placeholder="store.accountName"
                  class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
                  data-cy="branding-name"
                />
                <span class="text-[12.5px] font-normal leading-snug text-ink-muted">{{ t('Leave it empty to use your clinic\'s name.', 'Déjalo vacío para usar el nombre de tu clínica.') }}</span>
              </label>

              <div class="mt-5 flex flex-col gap-2">
                <span id="l-colour" class="text-[12.5px] font-semibold text-ink-500">{{ t('Colour', 'Color') }}</span>
                <div class="flex flex-wrap items-center gap-2" role="group" aria-labelledby="l-colour">
                  <button
                    v-for="preset in CLINIC_BRAND_PRESETS"
                    :key="preset"
                    type="button"
                    class="h-8 w-8 rounded-full border border-line-control ring-offset-2 ring-offset-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand touch:h-10 touch:w-10"
                    :class="(color || QUIROFLOW_COLOR) === preset ? 'ring-2 ring-ink-900' : ''"
                    :style="{ backgroundColor: preset }"
                    :aria-label="preset === QUIROFLOW_COLOR ? t('QuiroFlow indigo', 'Índigo de QuiroFlow') : preset"
                    :aria-pressed="(color || QUIROFLOW_COLOR) === preset"
                    :data-cy="`branding-preset-${preset.slice(1)}`"
                    @click="pickColor(preset === QUIROFLOW_COLOR ? '' : preset)"
                  />
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    :value="color || QUIROFLOW_COLOR"
                    class="h-9 w-11 cursor-pointer rounded-ctl border border-line-control bg-surface p-1 touch:h-11"
                    :aria-label="t('Pick a colour', 'Elegir un color')"
                    @input="pickColor(($event.target as HTMLInputElement).value)"
                  />
                  <input
                    v-model="colorText"
                    maxlength="7"
                    :placeholder="QUIROFLOW_COLOR"
                    class="h-9 w-28 rounded-ctl border bg-surface px-3 font-mono text-[14px] text-ink-900 focus:outline-none focus:ring-1 touch:h-11"
                    :class="colorInvalid ? 'border-danger-text focus:border-danger-text focus:ring-danger-text' : 'border-line-control focus:border-brand focus:ring-brand'"
                    :aria-label="t('Colour code', 'Código del color')"
                    :aria-invalid="colorInvalid"
                    data-cy="branding-colour"
                    @input="onColorTyped"
                  />
                </div>
                <p class="text-[12.5px] leading-snug text-ink-muted">
                  {{ t('One colour is enough: buttons, links and highlights are worked out from it for the light and the dark theme, and adjusted so the text can always be read.', 'Basta un color: los botones, los enlaces y los resaltados se calculan a partir de él para el tema claro y el oscuro, y se ajustan para que el texto se lea siempre.') }}
                </p>
              </div>

              <div class="mt-5 flex items-center gap-3 border-t border-line-row pt-4">
                <UiBtn variant="primary" :disabled="saving || !dirty" data-cy="branding-save" @click="save">
                  {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
                </UiBtn>
                <span v-if="dirty" class="text-[12.5px] text-ink-muted">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
              </div>
            </section>

            <section aria-labelledby="h-preview" class="rounded-card border border-line bg-surface px-[18px] py-4">
              <h2 id="h-preview" class="text-[16px] font-bold text-ink-900">{{ t('What patients see', 'Lo que ven los pacientes') }}</h2>
              <p class="mt-1 text-[13.5px] leading-snug text-ink-muted">{{ t('In the light and the dark theme, as each phone is set.', 'En el tema claro y en el oscuro, según tenga el teléfono cada paciente.') }}</p>

              <div class="mt-4 grid grid-cols-2 gap-3" aria-hidden="true">
                <div
                  v-for="theme in PREVIEW_THEMES"
                  :key="theme"
                  class="overflow-hidden rounded-[18px] border"
                  :style="`${previewStyle(theme)} background-color: rgb(var(--pv-page)); border-color: rgb(var(--pv-line)); color: rgb(var(--pv-ink));`"
                  :data-cy="`branding-preview-${theme}`"
                >
                  <div class="flex items-center gap-2 px-3 pb-2 pt-3">
                    <img v-if="logoUrl" :src="logoUrl" alt="" class="h-6 w-6 shrink-0 rounded-[6px] object-contain" />
                    <span v-else class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-brand text-[9.5px] font-bold text-brand-on">{{ initials }}</span>
                    <span class="truncate text-[12.5px] font-semibold" data-cy="branding-preview-name">{{ shownName }}</span>
                  </div>
                  <div class="mx-3 rounded-[12px] border border-brand-tintBorder bg-brand-tint p-3">
                    <p class="text-[10.5px] font-semibold uppercase tracking-[.06em] text-brand-text">{{ t('Next visit', 'Próxima cita') }}</p>
                    <p class="mt-1 text-[13px] font-semibold">{{ t('Thursday, 10:30', 'Jueves, 10:30') }}</p>
                    <p class="text-[11.5px]" style="color: rgb(var(--pv-muted))">{{ t('Adjustment', 'Ajuste') }}</p>
                  </div>
                  <div class="mx-3 mt-2.5 flex h-9 items-center justify-center rounded-[10px] bg-brand text-[12.5px] font-semibold text-brand-on">
                    {{ t('Book a visit', 'Reservar cita') }}
                  </div>
                  <p class="mx-3 mt-2.5 text-[11.5px] font-medium text-brand-text2">{{ t('See all my visits', 'Ver todas mis citas') }}</p>
                  <div class="mt-3 flex justify-around border-t px-2 py-2.5 text-[10px] font-medium" style="border-color: rgb(var(--pv-line)); background-color: rgb(var(--pv-surface))">
                    <span class="text-brand-text">{{ t('Home', 'Inicio') }}</span>
                    <span style="color: rgb(var(--pv-muted))">{{ t('Visits', 'Citas') }}</span>
                    <span style="color: rgb(var(--pv-muted))">{{ t('Messages', 'Mensajes') }}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
