<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

defineProps<{ firstChargeDate: string | null }>()
const t = useT()
</script>

<template>
  <div class="flex flex-col items-center px-4 py-10 text-center">
    <span class="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-line bg-surface-subtle">
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[18px] w-[18px] text-ink-muted">
        <path d="M4 2.8h10v12.4l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M7 6.6h4M7 9.4h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </span>
    <h4 class="mt-3.5 text-[15px] font-semibold text-ink-900">{{ t('No payments yet', 'Todavía no hay pagos') }}</h4>
    <p class="mt-2 max-w-[380px] text-[13px] leading-[1.55] text-ink-muted">
      <template v-if="firstChargeDate">
        {{ t('Your first charge lands on', 'Tu primer cargo será el') }} {{ formatLongDate(firstChargeDate) }}.
      </template>
      <template v-else>
        {{ t('Nothing has been charged to this account.', 'No se ha cobrado nada en esta cuenta.') }}
      </template>
    </p>
  </div>
</template>
