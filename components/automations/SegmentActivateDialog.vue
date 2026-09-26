<script setup lang="ts">
import { weekdayName } from '~/utils/automationCatalog'

// Switching a segment on: how many patients match today and when they enter,
// and -- for a marketing one -- how many accepted each channel. The safe
// alternative is right there: switch it on in test mode first.

const props = defineProps<{
  filters: Record<string, any>
  isMarketing: boolean
  schedule: { kind: 'once' | 'daily' | 'weekly'; weekday?: number; time?: string } | null | undefined
  ruleId: string | null
  entryMode: string
  busy?: boolean
}>()
const emit = defineEmits<{ activate: [testMode: boolean]; cancel: [] }>()
const t = useT()

const preview = ref<{ count: number; alreadyIn: number; whatsapp: number; email: number } | null>(null)
onMounted(async () => {
  try {
    preview.value = await useStaffFetch('/api/automations/segment-preview', {
      method: 'POST',
      body: { filters: props.filters, isMarketing: props.isMarketing, ruleId: props.ruleId, entryMode: props.entryMode },
    })
  } catch {
    preview.value = null
  }
})
const count = computed(() => (preview.value ? preview.value.count - preview.value.alreadyIn : null))
const when = computed(() => {
  const s = props.schedule
  if (!s || s.kind === 'once') return t('now (within 15 minutes)', 'ahora (antes de 15 minutos)')
  if (s.kind === 'daily') return t(`at ${s.time ?? '09:00'}, and every day after that, the new ones`, `a las ${s.time ?? '09:00'}, y después cada día, los nuevos`)
  return t(`on ${weekdayName(t, s.weekday ?? 1)} at ${s.time ?? '09:00'}, and every week after that, the new ones`, `el ${weekdayName(t, s.weekday ?? 1)} a las ${s.time ?? '09:00'}, y después cada semana, los nuevos`)
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center" @click.self="emit('cancel')">
    <div role="dialog" aria-modal="true" aria-labelledby="seg-title" class="w-full max-w-[520px] rounded-card border border-line bg-surface shadow-popover" data-test="segment-activate">
      <div class="flex flex-col gap-3 px-6 pb-2 pt-6">
        <h2 id="seg-title" class="text-[18px] font-bold text-ink-900">{{ t('Switch on a group', 'Activar un segmento') }}</h2>
        <p class="text-[14px] leading-relaxed text-ink-500">
          <strong>{{ count === null ? '…' : t(`${count} patients`, `${count} pacientes`) }}</strong>
          {{ t(`match today and will enter ${when}.`, `coinciden hoy y entrarán ${when}.`) }}
        </p>
        <p v-if="isMarketing && preview" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[13px] text-ink-700">
          {{ t('It is marketing: of them,', 'Es comercial: de ellos,') }} <strong>{{ preview.whatsapp }}</strong> {{ t('accepted WhatsApp and', 'aceptaron WhatsApp y') }} <strong>{{ preview.email }}</strong> {{ t('email.', 'email.') }}
        </p>
      </div>
      <div class="flex flex-wrap justify-end gap-2 px-6 pb-6 pt-4">
        <button type="button" class="h-9 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle touch:h-11" @click="emit('cancel')">{{ t('Cancel', 'Cancelar') }}</button>
        <button type="button" class="h-9 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle touch:h-11" :disabled="busy" data-test="segment-activate-test" @click="emit('activate', true)">{{ t('Try first (test mode)', 'Probar primero (modo prueba)') }}</button>
        <button type="button" class="h-9 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover touch:h-11" :disabled="busy" data-test="segment-activate-confirm" @click="emit('activate', false)">{{ t('Switch on', 'Activar') }}</button>
      </div>
    </div>
  </div>
</template>
