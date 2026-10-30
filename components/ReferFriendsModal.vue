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

function copy() {
  navigator.clipboard?.writeText(referralLink.value)
  showToast(t('Link copied', 'Enlace copiado'))
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="max-h-full w-full overflow-y-auto max-w-md rounded-card bg-surface shadow-xl">
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h3 :id="dialogTitleId" class="text-[13.5px] font-semibold text-ink-900">{{ t('Refer Your Friends!', '¡Recomienda a tus amigos!') }}</h3>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle touch:h-10 touch:w-10" @click="emit('close')">✕</button>
      </div>
      <div class="p-4">
        <p class="text-[13px] text-ink-muted">
          {{ t('Know another clinic that would like QuiroFlow? Share your link — when they sign up, we\'ll know it came from you.', '¿Conoces otra clínica a la que le gustaría QuiroFlow? Comparte tu enlace — cuando se registren, sabremos que vino de ti.') }}
        </p>
        <div class="mt-3 flex items-center gap-2 rounded-ctl border border-line-control bg-surface-subtle px-3 py-2">
          <span class="flex-1 truncate text-[12.5px] text-ink-700">{{ referralLink }}</span>
          <button type="button" class="shrink-0 text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="copy">
            {{ t('Copy', 'Copiar') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
