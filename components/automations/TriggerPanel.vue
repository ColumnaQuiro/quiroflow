<script setup lang="ts">
import { ENTRY_MODES, TRIGGERS, TRIGGER_GROUPS, say, triggerDef, weekdayName } from '~/utils/automationCatalog'
import { FIELD, FIELD_NUMBER, HINT, LABEL, NOTE, SECTION, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'

// The trigger: what starts the automation, "only if" filters, and who can
// enter again -- or, for a segment, which patients and when, with a live
// count of who matches today.

const b = useBuilder()
const t = useT()

const rule = computed(() => b.draft.value.rule)
const def = computed(() => triggerDef(rule.value.trigger_event))
const isSegment = computed(() => rule.value.trigger_event === 'segment')
const lockedLead = computed(() => b.isLead.value && !b.hasGrowth.value)
const totals = computed(() => b.stats.value.rule)

function setFilters(filters: Record<string, any>) {
  b.updateRule({ filters })
}
function setNumberFilter(key: 'hours_before' | 'days_after', raw: string, fallback: number) {
  b.updateRule({ filters: { ...rule.value.filters, [key]: Math.max(1, Math.round(Number(raw) || fallback)) } })
}

// ---- segment
const segment = computed(() => rule.value.segment ?? { filters: {}, schedule: { kind: 'weekly' as const, weekday: 1, time: '10:00' }, reentry_days: null })
function setSegment(patch: Record<string, any>) {
  b.updateRule({ segment: { ...segment.value, ...patch } })
}
function setSchedule(patch: Record<string, any>) {
  setSegment({ schedule: { ...segment.value.schedule, ...patch } })
}
const recurring = computed(() => segment.value.schedule?.kind !== 'once')
const TIMES = Array.from({ length: 28 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

// "Only those who have not been through here yet" is once_ever; "may come
// back after N days" lets them in again once their last run is that old.
const reentry = computed(() => (segment.value.reentry_days ? 'after' : 'once'))
function setReentry(kind: 'once' | 'after') {
  if (kind === 'once') {
    setSegment({ reentry_days: null })
    b.updateRule({ entry_mode: 'once_ever' })
  } else {
    setSegment({ reentry_days: segment.value.reentry_days || 90 })
    b.updateRule({ entry_mode: 'one_at_a_time' })
  }
}

const preview = ref<{ count: number; alreadyIn: number; whatsapp: number; email: number; sample: { id: string; name: string }[] } | null>(null)
const previewing = ref(false)
const showSample = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
async function refreshPreview() {
  if (!isSegment.value) return
  previewing.value = true
  try {
    preview.value = await useStaffFetch('/api/automations/segment-preview', {
      method: 'POST',
      body: { filters: segment.value.filters ?? {}, isMarketing: rule.value.is_marketing, ruleId: b.ruleId.value, entryMode: rule.value.entry_mode },
    })
  } catch {
    preview.value = null
  } finally {
    previewing.value = false
  }
}
watch(
  () => [isSegment.value, JSON.stringify(segment.value.filters), rule.value.is_marketing],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(refreshPreview, 400)
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="lockedLead" class="flex flex-col gap-2 rounded-card border border-line bg-surface-subtle p-3.5" data-test="no-growth">
      <strong class="text-[13.5px] text-ink-900">{{ t('Lead automations are part of Growth.', 'Las automatizaciones de leads son de Growth.') }}</strong>
      <span class="text-[12.5px] leading-snug text-ink-500">{{ t('With Growth, every lead from your ads or your website enters here within minutes and is followed up until they book.', 'Con Growth, cada lead de tus anuncios o de la web entra aquí en minutos y recibe un seguimiento hasta que reserva.') }}</span>
      <NuxtLink to="/growth" class="inline-flex h-9 items-center self-start rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-surface hover:bg-brand-hover touch:h-11">{{ t('See Growth', 'Ver Growth') }}</NuxtLink>
      <p :class="HINT">{{ t('This automation is paused and kept exactly as it is. It works again as soon as Growth is on.', 'Esta automatización está pausada y guardada tal cual. Vuelve a funcionar al activar Growth.') }}</p>
    </div>

    <label :class="LABEL">
      {{ t('When…', 'Cuando…') }}
      <select :class="FIELD" :value="rule.trigger_event" data-test="trigger-select" @change="b.setTrigger(($event.target as HTMLSelectElement).value)">
        <optgroup v-for="g in TRIGGER_GROUPS" :key="g.key" :label="say(t, g.label)">
          <option
            v-for="tr in TRIGGERS.filter((x) => x.group === g.key)"
            :key="tr.value"
            :value="tr.value"
            :disabled="tr.growth && !b.hasGrowth.value && rule.trigger_event !== tr.value"
          >{{ say(t, tr.sentence) }}{{ tr.growth ? ' · GROWTH' : '' }}</option>
        </optgroup>
      </select>
    </label>
    <p v-if="def" :class="HINT">{{ say(t, def.description) }}</p>

    <label v-if="rule.trigger_event === 'appointment.hours_before'" :class="LABEL">
      {{ t('Hours before the appointment', 'Horas antes de la cita') }}
      <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.hours_before ?? 24" data-test="trigger-hours-before" @input="setNumberFilter('hours_before', ($event.target as HTMLInputElement).value, 24)" />
      <span :class="HINT">{{ t('For a second reminder at another time, create another automation on this trigger.', 'Para un segundo recordatorio en otro momento, crea otra automatización con este disparador.') }}</span>
    </label>
    <label v-if="rule.trigger_event === 'appointment.review_request'" :class="LABEL">
      {{ t('Days after the visit', 'Días después de la cita') }}
      <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.days_after ?? 2" data-test="trigger-days-after" @input="setNumberFilter('days_after', ($event.target as HTMLInputElement).value, 2)" />
    </label>

    <!-- A group of patients -->
    <template v-if="isSegment">
      <div :class="SEGMENT_WRAP" role="group" :aria-label="t('How often', 'Con qué frecuencia')">
        <button type="button" :class="segmentBtn(!recurring)" :aria-pressed="!recurring" data-test="segment-once" @click="setSchedule({ kind: 'once' })">{{ t('Once', 'Una vez') }}</button>
        <button type="button" :class="segmentBtn(recurring)" :aria-pressed="recurring" data-test="segment-recurring" @click="setSchedule({ kind: 'weekly', weekday: segment.schedule?.weekday ?? 1, time: segment.schedule?.time ?? '10:00' })">{{ t('Repeats', 'Se repite') }}</button>
      </div>
      <div v-if="recurring" class="grid grid-cols-2 gap-2.5">
        <label :class="LABEL">
          {{ t('Every', 'Cada') }}
          <select
            :class="FIELD"
            :value="segment.schedule?.kind === 'daily' ? 'daily' : String(segment.schedule?.weekday ?? 1)"
            data-test="segment-day"
            @change="(e) => { const v = (e.target as HTMLSelectElement).value; setSchedule(v === 'daily' ? { kind: 'daily', weekday: undefined } : { kind: 'weekly', weekday: Number(v) }) }"
          >
            <option value="daily">{{ t('Day', 'Día') }}</option>
            <option v-for="d in 7" :key="d" :value="String(d)">{{ weekdayName(t, d) }}</option>
          </select>
        </label>
        <label :class="LABEL">
          {{ t('At', 'A las') }}
          <select :class="FIELD" :value="segment.schedule?.time ?? '10:00'" data-test="segment-time" @change="setSchedule({ time: ($event.target as HTMLSelectElement).value })">
            <option v-for="tm in TIMES" :key="tm" :value="tm">{{ tm }}</option>
          </select>
        </label>
      </div>
      <p v-else :class="HINT">{{ t('Everyone who matches enters once, at the next check after it is switched on (within 15 minutes).', 'Todos los que coinciden entran una vez, en la siguiente revisión tras activarla (antes de 15 minutos).') }}</p>

      <div class="flex flex-col gap-2">
        <span :class="SECTION">{{ t('Patients who', 'Pacientes que') }}</span>
        <AutomationsFilterEditor
          :model-value="segment.filters ?? {}"
          mode="segment"
          :appointment-context="false"
          test-prefix="segment-filter"
          @update:model-value="setSegment({ filters: $event })"
        />
      </div>

      <div class="flex flex-col gap-1.5 rounded-card border border-brand-tintBorder bg-brand-tint px-3.5 py-3" data-test="segment-count">
        <div class="flex items-baseline gap-2">
          <strong class="font-mono text-[22px] text-brand-text">{{ previewing && !preview ? '…' : (preview?.count ?? '—') }}</strong>
          <span class="text-[12.5px] text-ink-700">
            {{ t('patients match today.', 'pacientes coinciden hoy.') }}
            <button v-if="preview?.count" type="button" class="font-semibold text-brand-text underline" @click="showSample = !showSample">{{ showSample ? t('Hide the list', 'Ocultar la lista') : t('See the list', 'Ver la lista') }}</button>
          </span>
        </div>
        <p v-if="preview && preview.alreadyIn > 0" :class="HINT">{{ t(`${preview.alreadyIn} of them have already been through, so they will not enter again.`, `${preview.alreadyIn} ya han pasado por aquí, así que no volverán a entrar.`) }}</p>
        <ul v-if="showSample && preview" class="mt-1 max-h-40 overflow-y-auto text-[12.5px] text-ink-700">
          <li v-for="p in preview.sample" :key="p.id"><NuxtLink :to="`/patients/${p.id}`" class="hover:underline">{{ p.name }}</NuxtLink></li>
          <li v-if="preview.count > preview.sample.length" class="text-ink-muted">{{ t(`and ${preview.count - preview.sample.length} more`, `y ${preview.count - preview.sample.length} más`) }}</li>
        </ul>
      </div>

      <div v-if="recurring" class="flex flex-col gap-2" role="radiogroup" :aria-label="t('Each time it repeats', 'Cada vez que se repite')">
        <span :class="SECTION">{{ t('Each time it repeats', 'Cada vez que se repite') }}</span>
        <label class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="reentry" class="h-4 w-4 accent-brand" :checked="reentry === 'once'" @change="setReentry('once')" />
          {{ t('Only those who have not been through here yet', 'Solo entran los que aún no han pasado por aquí') }}
        </label>
        <label class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="reentry" class="h-4 w-4 accent-brand" :checked="reentry === 'after'" @change="setReentry('after')" />
          {{ t('They can enter again after', 'Pueden volver a entrar pasados') }}
          <input
            type="number"
            min="1"
            :class="FIELD_NUMBER"
            :value="segment.reentry_days ?? 90"
            :aria-label="t('days', 'días')"
            :disabled="reentry !== 'after'"
            @input="setSegment({ reentry_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 90)) })"
          />
          {{ t('days', 'días') }}
        </label>
      </div>
      <p :class="NOTE">{{ t('Minors and patients marked "do not contact" never enter. Marketing consent is applied to every marketing message.', 'Menores y pacientes con «no contactar» nunca entran. El consentimiento de marketing se aplica en cada mensaje comercial.') }}</p>
    </template>

    <!-- An event -->
    <template v-else-if="!b.isLead.value">
      <div class="flex flex-col gap-2">
        <span :class="SECTION">{{ t('Only if', 'Solo si') }}</span>
        <AutomationsFilterEditor
          :model-value="rule.filters"
          mode="trigger"
          :appointment-context="def?.appointmentContext ?? false"
          test-prefix="trigger-filter"
          @update:model-value="setFilters"
        />
      </div>

      <div class="flex flex-col gap-2" role="radiogroup" :aria-label="t('If they are already inside', 'Si ya está dentro')">
        <span :class="SECTION">{{ t('If they are already inside', 'Si ya está dentro') }}</span>
        <label v-for="m in ENTRY_MODES" :key="m.value" class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="entry" class="h-4 w-4 accent-brand" :checked="rule.entry_mode === m.value" :data-test="`entry-${m.value}`" @change="b.updateRule({ entry_mode: m.value })" />
          {{ say(t, m.label) }}
        </label>
      </div>
    </template>

    <p v-else :class="HINT">{{ t('A lead enters once, ever: the same lead never gets this sequence twice.', 'Un lead entra una sola vez: el mismo lead nunca recibe esta secuencia dos veces.') }}</p>

    <!-- The whole automation's last 30 days, every step together. -->
    <template v-if="totals">
      <span :class="SECTION">{{ t('This automation, last 30 days', 'Esta automatización, últimos 30 días') }}</span>
      <div class="grid grid-cols-2 gap-2" data-test="rule-totals">
        <div class="flex flex-col rounded-ctl border border-line bg-surface-subtle p-3">
          <span class="text-[11px] text-ink-muted">{{ t('Entered', 'Entraron') }}</span>
          <span class="font-mono text-[16px] font-semibold text-ink-900" data-test="rule-entered">{{ totals.entered }}</span>
        </div>
        <div class="flex flex-col rounded-ctl border border-line bg-surface-subtle p-3">
          <span class="text-[11px] text-ink-muted">{{ t('Inside now', 'Dentro ahora') }}</span>
          <span class="font-mono text-[16px] font-semibold text-ink-900">{{ totals.inside }}</span>
        </div>
      </div>
      <AutomationsMessageStats
        v-if="totals.whatsapp.sent + totals.whatsapp.failed + totals.whatsapp.recorded > 0 || b.draft.value.steps.some((s) => s.action_type === 'whatsapp_template')"
        channel="whatsapp"
        :stats="totals.whatsapp"
        :hidden="!b.canReadWhatsApp.value"
        test-id="rule-whatsapp-stats"
      />
      <AutomationsMessageStats
        v-if="totals.email.sent + totals.email.recorded > 0 || b.draft.value.steps.some((s) => s.action_type === 'email')"
        channel="email"
        :stats="totals.email"
        test-id="rule-email-stats"
      />
    </template>
  </div>
</template>
