<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()

const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))
const store = useAccountStore()
const { showToast } = useToast()

const referralLink = computed(() => `${window.location.origin}/signup?ref=${store.accountSlug}`)

// The offer the dialog promises, from the same constant the billing webhook
// applies it with (utils/clinicReferral.ts, server/utils/clinicReferralRewards.ts).
const DISCOUNT_PERCENT = CLINIC_REFERRAL_DISCOUNT_PERCENT

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(referralLink.value)
  } catch {
    showToast(t('Could not copy — select the link and copy it by hand', 'No se pudo copiar — selecciona el enlace y cópialo a mano'))
    return
  }
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 2000)
  showToast(t('Link copied', 'Enlace copiado'))
}

onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
  <!-- Teleported: the sidebar that opens it is its own containing block, so a
  fixed overlay left inside it is clipped to the sidebar's width. -->
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
      <div
        ref="dialogPanel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="dialogTitleId"
        class="max-h-full w-full max-w-xl overflow-y-auto rounded-card bg-surface shadow-xl"
        data-cy="refer-friends-dialog"
      >
        <div class="px-6 pb-6 pt-7 sm:px-8 sm:pt-8">
          <div class="flex items-start justify-between gap-4">
            <h2 :id="dialogTitleId" class="text-[26px] font-semibold leading-tight text-ink-900 sm:text-[30px]">
              {{ t('Refer your friends!', '¡Recomienda a tus amigos!') }}
            </h2>
            <button
              type="button"
              :aria-label="t('Close', 'Cerrar')"
              class="-mr-2 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle touch:h-10 touch:w-10"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <p class="mt-4 text-[15px] leading-relaxed text-ink-700">
            {{ t(
              `Know another clinic that would like QuiroFlow? When they subscribe with your link, you both get ${DISCOUNT_PERCENT}% off your regular subscription for one month.`,
              `¿Conoces otra clínica a la que le gustaría QuiroFlow? Cuando se suscriba con tu enlace, las dos tendréis un ${DISCOUNT_PERCENT}% de descuento en vuestra suscripción normal durante un mes.`,
            ) }}
          </p>

          <div class="mt-5 grid grid-cols-2 gap-3">
            <div class="rounded-ctl border border-line bg-surface-subtle px-4 py-3">
              <div class="text-[24px] font-semibold leading-none text-brand-text">{{ DISCOUNT_PERCENT }}%</div>
              <div class="mt-1.5 text-[13px] text-ink-muted">{{ t('for you, for one month', 'para ti, durante un mes') }}</div>
            </div>
            <div class="rounded-ctl border border-line bg-surface-subtle px-4 py-3">
              <div class="text-[24px] font-semibold leading-none text-brand-text">{{ DISCOUNT_PERCENT }}%</div>
              <div class="mt-1.5 text-[13px] text-ink-muted">{{ t('for your friend, for one month', 'para tu amigo, durante un mes') }}</div>
            </div>
          </div>

          <p class="mt-6 text-[15px] text-ink-700">
            {{ t('Click your unique link to copy and share it.', 'Haz clic en tu enlace para copiarlo y compartirlo.') }}
          </p>
          <button
            type="button"
            class="mt-2 flex w-full items-center gap-3 rounded-ctl border border-line-control bg-surface-subtle px-3.5 py-3 text-left hover:border-brand"
            data-cy="refer-friends-link"
            @click="copy"
          >
            <span class="min-w-0 flex-1 break-all font-mono text-[13.5px] text-brand-text">{{ referralLink }}</span>
            <span class="shrink-0 text-[13px] font-medium text-ink-600">
              {{ copied ? t('Copied ✓', 'Copiado ✓') : t('Copy', 'Copiar') }}
            </span>
          </button>

          <p class="mt-3 text-[12.5px] text-ink-muted">
            {{ t(
              'The discount applies once the new clinic starts a paid subscription, on the regular plan price.',
              'El descuento se aplica cuando la nueva clínica empieza una suscripción de pago, sobre el precio normal del plan.',
            ) }}
          </p>

          <div class="mt-6 flex justify-end">
            <button
              type="button"
              class="rounded-ctl bg-brand px-6 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover"
              @click="emit('close')"
            >
              {{ t('OK', 'Vale') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
