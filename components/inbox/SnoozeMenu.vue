<script setup lang="ts">
import { snoozePresets } from '../../utils/inboxSnooze'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, wallClockToUtc } from '../../utils/clinicClock'

// "Posponer": hide a conversation from my Inbox until a time, when it comes
// back to the top as a follow-up (inbox_snoozes; the rule is in the view).
// Just for the person who snoozes it, like archiving. The web Inbox and the
// staff app's both use this menu.
const props = defineProps<{ snoozedUntil?: string | null; timeZone?: string | null; size?: 'sm' | 'lg' }>()
const emit = defineEmits<{ snooze: [at: string]; unsnooze: [] }>()

const t = useT()
const open = ref(false)
const root = ref<HTMLElement>()
const tz = computed(() => props.timeZone || DEFAULT_CLINIC_TIMEZONE)
const presets = computed(() => (open.value ? snoozePresets(new Date(), tz.value) : []))
const PRESET_LABEL = computed<Record<string, string>>(() => ({ later: t('Later today', 'Más tarde hoy'), tomorrow: t('Tomorrow', 'Mañana'), next_week: t('Next week', 'La semana que viene') }))
const locale = computed(() => t('en-GB', 'es-ES'))
function when(at: Date | string) {
  const d = new Date(at)
  const day = clinicDateOf(d, tz.value)
  const today = clinicDateOf(new Date(), tz.value)
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: tz.value })
  if (day === today) return t(`today ${time}`, `hoy ${time}`)
  return `${d.toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz.value })}, ${time}`
}

// A date and time of the person's own choosing, read on the clinic's clock.
const customDate = ref('')
const customTime = ref('09:00')
const customAt = computed(() => (customDate.value && /^\d{2}:\d{2}$/.test(customTime.value) ? new Date(wallClockToUtc(customDate.value, customTime.value, tz.value)) : null))
const customValid = computed(() => !!customAt.value && customAt.value.getTime() > Date.now())
const minDate = computed(() => clinicDateOf(new Date(), tz.value))

function pick(at: Date) {
  open.value = false
  emit('snooze', at.toISOString())
}
function clear() {
  open.value = false
  emit('unsnooze')
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
const snoozed = computed(() => !!props.snoozedUntil && Date.parse(props.snoozedUntil) > Date.now())
const btn = computed(() => (props.size === 'lg' ? 'h-11 w-11' : 'h-9 touch:h-11 w-9 touch:w-11'))
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      data-cy="thread-snooze"
      class="flex shrink-0 items-center justify-center rounded-ctl border bg-surface"
      :class="[btn, snoozed ? 'border-brand text-brand-text' : 'border-line-control text-ink-500 hover:bg-surface-subtle']"
      :aria-label="snoozed ? t(`Snoozed until ${when(snoozedUntil!)}`, `Pospuesta hasta ${when(snoozedUntil!)}`) : t('Snooze (just for you)', 'Posponer (solo para ti)')"
      :title="snoozed ? t(`Snoozed until ${when(snoozedUntil!)}`, `Pospuesta hasta ${when(snoozedUntil!)}`) : t('Snooze (just for you)', 'Posponer (solo para ti)')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M5 3L2 6M19 3l3 3" /></svg>
    </button>
    <div v-if="open" role="menu" :aria-label="t('Snooze until', 'Posponer hasta')" class="absolute right-0 top-[calc(100%+4px)] z-30 w-72 rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="thread-snooze-menu">
      <p class="px-2.5 pb-1 pt-1.5 text-[12.5px] font-semibold text-ink-muted">{{ t('Hide it until…', 'Ocultar hasta…') }}</p>
      <button
        v-for="p in presets"
        :key="p.key"
        type="button"
        role="menuitem"
        class="flex min-h-10 w-full items-center justify-between gap-2 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle"
        :data-cy="`thread-snooze-${p.key}`"
        @click="pick(p.at)"
      >
        <span>{{ PRESET_LABEL[p.key] }}</span>
        <span class="text-[12.5px] text-ink-muted">{{ when(p.at) }}</span>
      </button>
      <div class="mt-1 border-t border-line-row px-2.5 pb-1 pt-2">
        <p class="text-[12.5px] text-ink-muted">{{ t('Another time', 'Otra fecha') }}</p>
        <div class="mt-1 flex gap-1.5">
          <input v-model="customDate" type="date" :min="minDate" class="h-10 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2 text-[14px] text-ink-900" data-cy="thread-snooze-date" />
          <input v-model="customTime" type="time" class="h-10 w-[96px] rounded-ctl border border-line-control bg-surface px-2 text-[14px] text-ink-900" data-cy="thread-snooze-time" />
        </div>
        <button type="button" class="mt-1.5 h-10 w-full rounded-ctl bg-brand text-[13.5px] font-semibold text-white disabled:opacity-50" :disabled="!customValid" data-cy="thread-snooze-custom" @click="customAt && pick(customAt)">
          {{ t('Snooze', 'Posponer') }}
        </button>
      </div>
      <button v-if="snoozed" type="button" role="menuitem" class="mt-1 flex min-h-10 w-full items-center rounded-ctlSm border-t border-line-row px-2.5 text-left text-[14px] text-danger-text hover:bg-surface-subtle" data-cy="thread-unsnooze" @click="clear">
        {{ t('Stop snoozing', 'Quitar la posposición') }}
      </button>
      <p class="px-2.5 pb-1 pt-1.5 text-[11.5px] leading-snug text-ink-faint">{{ t('Only for you. It comes back sooner if they write.', 'Solo para ti. Vuelve antes si te escriben.') }}</p>
    </div>
  </div>
</template>
