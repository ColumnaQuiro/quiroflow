<script setup lang="ts">
// Last 30 days of one channel, for a step or for the whole automation:
// WhatsApp sent / delivered / read / failed, email sent / delivered / opened /
// clicked / bounced. Rates are of what was DELIVERED -- an open rate diluted
// by messages that never arrived measures the address list, not the message.
// Test-mode rows are counted apart: they were recorded, not sent.

const props = defineProps<{
  channel: 'whatsapp' | 'email'
  stats: {
    sent: number
    delivered: number
    read?: number
    opened?: number
    clicked?: number
    bounced?: number
    failed: number
    recorded: number
  }
  hidden?: boolean
  testId?: string
}>()
const t = useT()
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—')
const cells = computed(() => {
  const s = props.stats
  if (props.channel === 'whatsapp') {
    return [
      { label: t('Sent', 'Enviados'), value: String(s.sent) },
      { label: t('Delivered', 'Entregados'), value: String(s.delivered) },
      { label: t('Read', 'Leídos'), value: String(s.read ?? 0), sub: pct(s.read ?? 0, s.delivered) },
      { label: t('Failed', 'Fallidos'), value: String(s.failed), danger: s.failed > 0 },
    ]
  }
  return [
    { label: t('Sent', 'Enviados'), value: String(s.sent) },
    { label: t('Delivered', 'Entregados'), value: String(s.delivered) },
    { label: t('Opened', 'Abiertos'), value: String(s.opened ?? 0), sub: pct(s.opened ?? 0, s.delivered) },
    { label: t('Clicked', 'Clics'), value: String(s.clicked ?? 0), sub: pct(s.clicked ?? 0, s.delivered) },
    { label: t('Bounced / failed', 'Rebotados / fallidos'), value: String((s.bounced ?? 0) + s.failed), danger: (s.bounced ?? 0) + s.failed > 0 },
  ]
})
</script>

<template>
  <div class="flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle p-3" :data-test="testId">
    <span class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ channel === 'whatsapp' ? 'WhatsApp' : 'Email' }} · {{ t('last 30 days', 'últimos 30 días') }}</span>
    <p v-if="hidden" class="text-[12px] text-ink-muted">{{ t('Needs Inbox access.', 'Necesita acceso a la Bandeja.') }}</p>
    <div v-else class="grid grid-cols-3 gap-x-3 gap-y-2">
      <div v-for="c in cells" :key="c.label" class="flex flex-col" :data-test="`${testId}-${c.label}`">
        <span class="text-[11px] text-ink-muted">{{ c.label }}</span>
        <span class="font-mono text-[14px] font-semibold" :class="c.danger ? 'text-danger-text' : 'text-ink-900'">
          {{ c.value }}<span v-if="c.sub" class="ml-1 text-[11px] font-normal text-ink-muted">{{ c.sub }}</span>
        </span>
      </div>
    </div>
    <p v-if="!hidden && stats.recorded" class="text-[11.5px] text-warning-text">{{ t(`${stats.recorded} recorded in test mode, not sent.`, `${stats.recorded} registrados en modo prueba, sin enviar.`) }}</p>
  </div>
</template>
