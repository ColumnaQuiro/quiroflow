<script setup lang="ts">
import { FIELD, HINT, LABEL, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'
import { scheduledSendLabel } from '~/utils/automationDescribe'
import { clinicTimeLabel } from '~/utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '~/utils/clinicClock'

// When a one-off group send goes: at the next check after it is switched on,
// or on a date and time -- schedule.starts_at, which the engine waits for
// (lastScheduledOccurrence) and then claims once (enrolDueSegments), so it
// never goes twice. Taken in on the clinic's clock, so "10:00" means 10:00
// where the clinic is, whoever's laptop sets it: the account's first clinic,
// the zone the engine reads the schedule in.
//
// The same control in the trigger drawer and in a send's checklist, each with
// its own data-test prefix since both can be on screen at once.

const props = withDefaults(defineProps<{ testPrefix?: string }>(), { testPrefix: 'segment-once' })
const b = useBuilder()
const t = useT()
const { timeZone: tz } = useAccountTimeZone()

const segment = computed(() => b.draft.value.rule.segment ?? { filters: {}, schedule: { kind: 'once' as const }, reentry_days: null })
function setSchedule(patch: { starts_at?: string }) {
  b.updateRule({ segment: { ...segment.value, schedule: { ...segment.value.schedule, ...patch, kind: 'once' } } })
}

const scheduledAt = computed(() => segment.value.schedule?.starts_at ?? null)
const scheduledDate = computed(() => (scheduledAt.value ? clinicDateOf(new Date(scheduledAt.value), tz.value) : ''))
const scheduledTime = computed(() => (scheduledAt.value ? clinicTimeLabel(new Date(scheduledAt.value), tz.value) : '10:00'))
const scheduledPast = computed(() => !!scheduledAt.value && new Date(scheduledAt.value).getTime() <= Date.now())
function setOnceAt(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return
  setSchedule({ starts_at: new Date(wallClockToUtc(date, time, tz.value)).toISOString() })
}
function scheduleOnce() {
  if (scheduledAt.value) return
  // Tomorrow at 10:00 to start from; the desk changes it.
  setOnceAt(clinicDateOf(new Date(Date.now() + 86_400_000), tz.value), '10:00')
}

// Gone out: the date is history, and changing it would send nothing.
const sentAt = computed(() => b.lastRunAt.value)
const id = (suffix: string) => `${props.testPrefix}-${suffix}`
</script>

<template>
  <p v-if="sentAt" :class="HINT" :data-test="id('sent')">
    {{ t(`Went out on ${scheduledSendLabel(sentAt, t, tz)}. A one-off send goes once: to send it again, create a new one.`, `Salió el ${scheduledSendLabel(sentAt, t, tz)}. Un envío sale una sola vez: para repetirlo, crea uno nuevo.`) }}
  </p>
  <template v-else>
    <div :class="SEGMENT_WRAP" role="group" :aria-label="t('When', 'Cuándo')">
      <button type="button" :class="segmentBtn(!scheduledAt)" :aria-pressed="!scheduledAt" :data-test="id('now')" @click="setSchedule({ starts_at: undefined })">{{ t('Send when switched on', 'Enviar al activar') }}</button>
      <button type="button" :class="segmentBtn(!!scheduledAt)" :aria-pressed="!!scheduledAt" :data-test="id('scheduled')" @click="scheduleOnce()">{{ t('Schedule', 'Programar') }}</button>
    </div>
    <div v-if="scheduledAt" class="grid grid-cols-2 gap-2.5">
      <label :class="LABEL">
        {{ t('Day', 'Día') }}
        <input type="date" :class="FIELD" :value="scheduledDate" :data-test="id('date')" @change="setOnceAt(($event.target as HTMLInputElement).value, scheduledTime)" />
      </label>
      <label :class="LABEL">
        {{ t('At', 'A las') }}
        <input type="time" step="300" :class="FIELD" :value="scheduledTime" :data-test="id('time')" @change="setOnceAt(scheduledDate, ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <p v-if="scheduledAt && scheduledPast" :class="HINT" class="!text-warning-text" :data-test="id('past')">{{ t('That time has passed: they would enter at the next check after it is switched on.', 'Esa hora ya ha pasado: entrarían en la siguiente revisión tras activarla.') }}</p>
    <p v-else-if="scheduledAt" :class="HINT">{{ t(`Everyone who matches then enters once, on ${scheduledSendLabel(scheduledAt, t, tz)} (within 15 minutes). Switch it on beforehand: until then nothing is sent.`, `Todos los que coincidan entonces entran una vez, el ${scheduledSendLabel(scheduledAt, t, tz)} (antes de 15 minutos). Actívala antes: hasta entonces no se envía nada.`) }}</p>
    <p v-else :class="HINT">{{ t('Everyone who matches enters once, at the next check after it is switched on (within 15 minutes).', 'Todos los que coinciden entran una vez, en la siguiente revisión tras activarla (antes de 15 minutos).') }}</p>
  </template>
</template>
