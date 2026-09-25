<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'
import { formatPhoneDisplay } from '~/utils/phone'
import type { Tables } from '~/types/database.types'

// The patient's identity and the way to reach them, above every tab.
//
// This replaces a 56px header plus a 280px rail that between them said the
// same things twice: the rail repeated the name and the balance, and the
// contact details were only visible on Overview. The front desk needs the
// phone number on whichever tab they happen to be on, so it lives here and
// nowhere else.
const props = defineProps<{
  patient: Tables<'patients'>
  isVip: boolean
  /** What the patient can spend today; see UiBalancePill. */
  availableCents: number
  /** What is unpaid; see UiBalancePill. Not the balance. */
  outstandingCents: number
  clinicName: string | null
  practitionerName: string | null
  canContact: boolean
  canEdit: boolean
  canManageRecord: boolean
  canBook: boolean
  /** Take payment leads to the Money tab, which billing_history_view gates. */
  canCharge?: boolean
  archiving: boolean
  /** The patient's first number, from patient_contact_numbers. */
  primaryNumber: Tables<'patient_contact_numbers'> | null
  /** For a minor: whoever messages actually go to. Null otherwise. */
  tutor: { id: string; first_name: string; last_name: string | null } | null
}>()

defineEmits<{ message: []; book: []; charge: []; archive: []; merge: []; remove: []; photoUpdated: [] }>()

const t = useT()

const fullName = computed(() => [props.patient.first_name, props.patient.last_name].filter(Boolean).join(' '))
const initials = computed(() =>
  [props.patient.first_name?.[0], props.patient.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?',
)

const age = computed(() => {
  if (!props.patient.date_of_birth) return null
  const dob = new Date(props.patient.date_of_birth)
  const now = new Date()
  let years = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--
  return years
})

const identityLine = computed(() => {
  const parts: string[] = []
  if (age.value !== null) parts.push(String(age.value))
  if (props.patient.date_of_birth) parts.push(formatLongDate(props.patient.date_of_birth))
  parts.push(`${t('Patient since', 'Paciente desde')} ${formatLongDate(props.patient.created_at)}`)
  return parts.join(' · ')
})

const copied = ref<'phone' | 'email' | null>(null)
async function copy(value: string, which: 'phone' | 'email') {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = which
    setTimeout(() => (copied.value = null), 1800)
  } catch {
    // Clipboard blocked; the value is selectable on screen either way.
  }
}

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)

function closeMenu(restoreFocus = true) {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (restoreFocus) menuButton.value?.focus()
}
function onPointerDown(event: PointerEvent) {
  if (menuOpen.value && !menuRoot.value?.contains(event.target as Node)) closeMenu(false)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

const phone = computed(() =>
  props.primaryNumber ? formatPhoneDisplay(props.primaryNumber.number, props.primaryNumber.country_code) : null,
)

// tel: wants the digits, not the grouping -- the display form carries spaces
// that some dialers keep and then fail to call.
const telHref = computed(() => (phone.value ? `tel:${phone.value.replace(/[^\d+]/g, '')}` : null))
</script>

<template>
  <div class="rounded-card border border-line bg-surface px-4 py-3.5 shadow-card lg:px-[18px]">
    <div class="flex items-start gap-3 lg:items-center lg:gap-3.5">
      <NuxtLink
        to="/patients"
        :aria-label="t('Back to patients', 'Volver a pacientes')"
        class="hidden h-[30px] w-[30px] shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-muted outline-none hover:text-ink-700 focus-visible:shadow-focus lg:flex"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
          <path d="M10 3.5L5 8l5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </NuxtLink>

      <!-- The photo, not just the initials: this is also the only way into
           the upload flow, including the scan-with-your-phone QR. It lived in
           the rail, and when the rail went it took patient photos with it. -->
      <PatientsPhotoUpload
        class="shrink-0"
        :patient-id="patient.id"
        :photo-storage-path="patient.photo_storage_path"
        :initials="initials"
        @uploaded="$emit('photoUpdated')"
      />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="truncate text-[17px] font-semibold tracking-tightTitle text-ink-900 lg:text-[19px]">{{ fullName }}</h1>
          <!-- Pills are alerts, not readouts: each one is something a
               receptionist has to act differently because of. -->
          <UiPill v-if="isVip" tone="brand">{{ t('VIP', 'VIP') }}</UiPill>
          <!-- Money owed or money available, whichever applies -- the one
               figure the front desk glances at. UiBalancePill decides which,
               and renders nothing when neither is true. -->
          <UiBalancePill :available-cents="availableCents" :outstanding-cents="outstandingCents" />
          <UiPill v-if="patient.is_minor" tone="brand">{{ t('Minor', 'Menor') }}</UiPill>
          <!-- A minor has no Communications tab, which states the rule and
               not where to act on it. This is where to act on it. -->
          <NuxtLink
            v-if="patient.is_minor && tutor"
            :to="`/patients/${tutor.id}`"
            class="text-[12px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
          >
            {{ t('Messages go to', 'Los mensajes van a') }} {{ [tutor.first_name, tutor.last_name].filter(Boolean).join(' ') }} ↗
          </NuxtLink>
          <span v-else-if="patient.is_minor" class="text-[12px] text-danger-text">
            {{ t('No tutor linked', 'Sin tutor vinculado') }}
          </span>
          <UiPill v-if="patient.do_not_contact" tone="danger">{{ t('Do not contact', 'No contactar') }}</UiPill>
          <UiPill v-if="patient.status !== 'active'" tone="neutral">{{ t('Archived', 'Archivado') }}</UiPill>
          <UiPill v-if="!canEdit" tone="neutral">{{ t('View only', 'Solo lectura') }}</UiPill>
        </div>
        <p class="mt-1 text-[12.5px] text-ink-muted">{{ identityLine }}</p>
      </div>

      <!-- Message and Book visit are desktop-only here, because the phone
           has them at 46px in the row below. The overflow menu is NOT: it is
           the only route to Archive, Merge, Delete and Take payment, and
           hiding it below lg put all four out of reach on a phone, which is
           what half this clinic's front desk actually uses. -->
      <div ref="menuRoot" class="relative flex shrink-0 items-center gap-2">
        <button
          v-if="canContact"
          type="button"
          class="hidden h-[34px] items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:flex"
          @click="$emit('message')"
        >
          {{ t('Message', 'Mensaje') }}
        </button>
        <button
          v-if="canBook"
          type="button"
          class="hidden h-[34px] items-center rounded-ctl bg-brand px-3.5 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus lg:flex"
          @click="$emit('book')"
        >
          {{ t('Book visit', 'Reservar visita') }}
        </button>
        <button
          v-if="canManageRecord || canEdit"
          ref="menuButton"
          type="button"
          :aria-label="t('More actions', 'Más acciones')"
          :aria-expanded="menuOpen"
          class="flex h-11 w-11 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-muted outline-none hover:text-ink-700 focus-visible:shadow-focus lg:h-[34px] lg:w-[34px]"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="h-[18px] w-[18px]">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>

        <div v-if="menuOpen" class="absolute right-0 top-12 z-20 w-[220px] lg:top-[38px] rounded-card border border-line bg-surface py-1 shadow-popover">
          <!-- Taking a payment was a button in the rail; the rail is gone and
               this is where it went. Non-destructive, so it leads. -->
          <button
            v-if="canEdit && canCharge !== false"
            type="button"
            class="block w-full px-3 py-3 text-left text-[13px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle lg:py-2"
            @click="closeMenu(false); $emit('charge')"
          >
            {{ t('Take payment', 'Cobrar') }}
          </button>
          <button
            v-if="canEdit"
            type="button"
            :disabled="archiving"
            class="block w-full px-3 py-3 text-left text-[13px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle disabled:text-ink-faint lg:py-2"
            @click="closeMenu(false); $emit('archive')"
          >
            {{ patient.status === 'active' ? t('Archive patient', 'Archivar paciente') : t('Unarchive patient', 'Desarchivar paciente') }}
          </button>
          <button
            v-if="canManageRecord"
            type="button"
            class="block w-full px-3 py-3 text-left text-[13px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle lg:py-2"
            @click="closeMenu(false); $emit('merge')"
          >
            {{ t('Merge with another record', 'Fusionar con otra ficha') }}
          </button>
          <!-- Behind a divider, in danger, last. It used to sit next to
               "Book visit". -->
          <div v-if="canManageRecord" class="my-1 h-px bg-line-divider" />
          <button
            v-if="canManageRecord"
            type="button"
            class="block w-full px-3 py-3 text-left text-[13px] font-semibold text-danger-text outline-none hover:bg-danger-bg focus-visible:bg-danger-bg lg:py-2"
            @click="closeMenu(false); $emit('remove')"
          >
            {{ t('Delete patient', 'Eliminar paciente') }}
          </button>
        </div>
      </div>
    </div>

    <!-- The one home for contact details, present on every tab. -->
    <div class="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line-divider pt-3">
      <span v-if="phone" class="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-faint">
          <path d="M5.2 2.8 6.6 5.4 5.3 6.7a7.6 7.6 0 0 0 4 4l1.3-1.3 2.6 1.4-.5 2.2c-4.6.6-8.9-3.7-8.3-8.3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
        <!-- The flag was on the old rail's number and is worth keeping: a
             multi-country clinic reads it before the dial code. -->
        <span aria-hidden="true">{{ countryByCode(primaryNumber!.country_code).flag }}</span>
        <span class="font-mono text-[12.5px] text-ink-500">{{ phone }}</span>
        <button
          type="button"
          :aria-label="t('Copy phone number', 'Copiar teléfono')"
          class="flex h-5 w-5 items-center justify-center rounded text-ink-faint outline-none hover:text-ink-700 focus-visible:text-ink-700"
          @click="copy(phone, 'phone')"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.3" />
            <path d="M10.5 5.5v-1a1.6 1.6 0 0 0-1.6-1.6H4a1.6 1.6 0 0 0-1.6 1.6v4.9c0 .9.7 1.6 1.6 1.6h1" stroke="currentColor" stroke-width="1.3" />
          </svg>
        </button>
        <span v-if="copied === 'phone'" class="text-[11.5px] text-success-text">{{ t('Copied', 'Copiado') }}</span>
      </span>

      <span v-if="phone && patient.email" aria-hidden="true" class="hidden h-3 w-px bg-line lg:block" />

      <span v-if="patient.email" class="inline-flex min-w-0 items-center gap-1.5">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-faint">
          <rect x="2" y="3.8" width="12" height="8.4" rx="1.6" stroke="currentColor" stroke-width="1.3" />
          <path d="m2.4 4.6 5.6 3.8 5.6-3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <span class="truncate text-[12.5px] text-ink-500">{{ patient.email }}</span>
        <button
          type="button"
          :aria-label="t('Copy email address', 'Copiar correo')"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint outline-none hover:text-ink-700 focus-visible:text-ink-700"
          @click="copy(patient.email!, 'email')"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.3" />
            <path d="M10.5 5.5v-1a1.6 1.6 0 0 0-1.6-1.6H4a1.6 1.6 0 0 0-1.6 1.6v4.9c0 .9.7 1.6 1.6 1.6h1" stroke="currentColor" stroke-width="1.3" />
          </svg>
        </button>
        <span v-if="copied === 'email'" class="shrink-0 text-[11.5px] text-success-text">{{ t('Copied', 'Copiado') }}</span>
      </span>

      <template v-if="clinicName">
        <span aria-hidden="true" class="hidden h-3 w-px bg-line lg:block" />
        <span class="text-[12.5px] text-ink-500">{{ clinicName }}</span>
      </template>
      <template v-if="practitionerName">
        <span aria-hidden="true" class="hidden h-3 w-px bg-line lg:block" />
        <span class="text-[12.5px] text-ink-500">{{ practitionerName }}</span>
      </template>
    </div>

    <!-- Phone: the three things a thumb reaches for, at 46px. -->
    <div class="mt-3 flex gap-2 border-t border-line-divider pt-3 lg:hidden">
      <a
        v-if="canContact && phone"
        :href="telHref!"
        class="flex h-[46px] flex-1 items-center justify-center rounded-ctl border border-line-control text-[14px] font-semibold text-ink-700"
      >
        {{ t('Call', 'Llamar') }}
      </a>
      <button
        v-if="canContact"
        type="button"
        class="flex h-[46px] flex-1 items-center justify-center rounded-ctl border border-line-control text-[14px] font-semibold text-ink-700"
        @click="$emit('message')"
      >
        {{ t('Message', 'Mensaje') }}
      </button>
      <button
        v-if="canBook"
        type="button"
        class="flex h-[46px] flex-1 items-center justify-center rounded-ctl bg-brand text-[14px] font-semibold text-white"
        @click="$emit('book')"
      >
        {{ t('Book', 'Reservar') }}
      </button>
    </div>
  </div>
</template>
