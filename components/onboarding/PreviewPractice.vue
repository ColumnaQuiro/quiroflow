<script setup lang="ts">
import { countryByCode } from '~/utils/countries'
import { PREVIEW_PLACEHOLDERS, previewSlug } from './previewFixtures'

// Step 2's panel, bound to the form as it is typed.
//
// Debounced, because the panel redraws a mock app header, a URL and a
// locations card: rebuilding all three on every keystroke of a practice name
// is visible jitter right next to the field being typed in.
const props = defineProps<{ practice: string; location: string; countryCode: string }>()

const t = useT()

const practice = ref(props.practice)
const location = ref(props.location)
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => [props.practice, props.location],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      practice.value = props.practice
      location.value = props.location
    }, 150)
  },
)
onBeforeUnmount(() => clearTimeout(timer))

const practiceLabel = computed(
  () => practice.value.trim() || t(PREVIEW_PLACEHOLDERS.practice.en, PREVIEW_PLACEHOLDERS.practice.es),
)
const locationLabel = computed(
  () => location.value.trim() || t(PREVIEW_PLACEHOLDERS.location.en, PREVIEW_PLACEHOLDERS.location.es),
)
const initials = computed(() =>
  practiceLabel.value
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase(),
)
const dial = computed(() => countryByCode(props.countryCode).dial || '+34')
</script>

<template>
  <OnboardingPreview
    :eyebrow="t('Updating as you type', 'Se actualiza mientras escribes')"
    :title="t('This is how patients will find you', 'Así es como te encontrarán tus pacientes')"
    :body="
      t(
        'Your practice name heads every screen and becomes the address of your booking page.',
        'El nombre de tu consulta encabeza cada pantalla y da la dirección a tu página de reservas.',
      )
    "
  >
    <!-- The app header the practice name will sit in. -->
    <OnboardingPreviewFragment>
      <div class="flex items-center gap-[11px] px-4 py-[13px]">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl border border-brand-tintBorder bg-brand-tint">
          <span class="text-[11.5px] font-bold text-brand-text">{{ initials }}</span>
        </div>
        <span class="min-w-0 truncate rounded-[5px] bg-brand-tint px-[5px] py-px text-[15px] font-semibold leading-[1.4] text-ink-900">{{ practiceLabel }}</span>
        <span class="flex h-[26px] min-w-0 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-pill border border-line-control px-[9px]">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3 shrink-0 text-ink-muted">
            <path d="M8 14s5-4.2 5-7.6A5 5 0 0 0 3 6.4C3 9.8 8 14 8 14z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <circle cx="8" cy="6.4" r="1.7" stroke="currentColor" stroke-width="1.4" />
          </svg>
          <span class="max-w-[160px] truncate rounded px-1 text-[12px] font-semibold leading-[1.5] text-ink-700" :class="location.trim() && 'bg-brand-tint'">{{ locationLabel }}</span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-[11px] w-[11px] shrink-0 text-ink-muted">
            <path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="min-w-0 flex-1" />
        <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-subtle text-[11px] font-semibold text-ink-500">LG</span>
      </div>
      <div class="flex gap-5 border-t border-line-divider px-4">
        <span class="border-b-2 border-brand pb-[9px] pt-[11px] text-[13px] font-semibold text-ink-900">{{ t('Calendar', 'Agenda') }}</span>
        <span class="pb-[9px] pt-[11px] text-[13px] text-ink-muted">{{ t('Patients', 'Pacientes') }}</span>
        <span class="pb-[9px] pt-[11px] text-[13px] text-ink-muted">{{ t('Invoices', 'Facturas') }}</span>
        <span class="pb-[9px] pt-[11px] text-[13px] text-ink-muted">{{ t('Settings', 'Ajustes') }}</span>
      </div>
    </OnboardingPreviewFragment>

    <!-- The booking address the practice name builds: <account slug>.app.quiroflow.com,
         the subdomain register-clinic-subdomain adds. The clinic is not in it. -->
    <OnboardingPreviewFragment>
      <div class="p-4">
        <p class="text-[12.5px] font-semibold text-ink-muted">{{ t('Online booking page', 'Página de reservas online') }}</p>
        <div class="mt-[9px] flex items-center gap-2.5">
          <div class="flex h-[38px] flex-1 items-center overflow-hidden rounded-ctl border border-line-control bg-surface-subtle px-[11px]">
            <span class="truncate rounded px-1 py-px text-[13.5px] font-semibold text-ink-900" :class="practice.trim() && 'bg-brand-tint'">{{ previewSlug(practiceLabel) }}</span>
            <span class="shrink-0 text-[13.5px] text-ink-muted">.app.quiroflow.com</span>
          </div>
          <span class="flex h-[38px] shrink-0 items-center rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700">{{ t('Copy link', 'Copiar enlace') }}</span>
        </div>
        <p class="mt-[11px] text-[12.5px] leading-[1.5] text-ink-muted">
          {{ t('Patients pick a slot themselves. A number typed as 600 00 00 00 is read as', 'Los pacientes eligen su hora. Un número escrito como 600 00 00 00 se lee como') }}
          <span class="font-semibold text-ink-700">{{ dial }} 600 00 00 00</span>.
        </p>
      </div>
    </OnboardingPreviewFragment>

    <!-- What the first location becomes, and that more can follow. -->
    <OnboardingPreviewFragment>
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-[13px]">
        <span class="text-[13px] font-semibold text-ink-900">{{ t('Clinic locations', 'Clínicas') }}</span>
        <span class="text-[12px] text-ink-muted">{{ t('1 of unlimited', '1 de ilimitadas') }}</span>
      </div>
      <div class="flex items-center gap-[11px] px-4 py-[13px]">
        <div class="flex h-[30px] w-[30px] items-center justify-center rounded-ctl border border-brand-tintBorder bg-brand-tint">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 text-brand-text">
            <path d="M8 14s5-4.2 5-7.6A5 5 0 0 0 3 6.4C3 9.8 8 14 8 14z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <circle cx="8" cy="6.4" r="1.7" stroke="currentColor" stroke-width="1.4" />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13.5px] font-semibold text-ink-900">{{ locationLabel }}</div>
          <div class="mt-0.5 text-[12px] text-ink-muted">{{ t('Sala 1 · Sala 2 — add rooms in Settings', 'Sala 1 · Sala 2 — añade salas en Ajustes') }}</div>
        </div>
        <span class="shrink-0 rounded-pill border border-success-border bg-success-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-success-text">{{ t('Primary', 'Principal') }}</span>
      </div>
      <div class="flex items-center gap-[11px] border-t border-dashed border-line-control bg-surface-subtle px-4 py-[13px]">
        <div class="flex h-[30px] w-[30px] items-center justify-center rounded-ctl border border-dashed border-line-control">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 text-ink-muted">
            <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <span class="min-w-0 text-[13px] text-ink-muted">{{ t('Add Madrid, Alicante or another clinic whenever you’re ready', 'Añade Madrid, Alicante u otra clínica cuando quieras') }}</span>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
