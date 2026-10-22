<script setup lang="ts">
import type { ReceptionistConfig, ReceptionistType } from '~/composables/useGrowthReceptionist'

// How far ahead it offers times, how soon, and how many at once. These were
// shown as plain text while the endpoint accepted and validated all three:
// the sentence the model is given is built from exactly these numbers, so
// the owner should be the one setting them.
const props = defineProps<{
  config: ReceptionistConfig
  offeredTypes: ReceptionistType[]
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()

// The server's own bounds (config.put.ts), so a value it would refuse is
// never offered to it.
const FIELDS = [
  { key: 'bookingWindowDays' as const, min: 1, max: 90, label: t('Offers times up to', 'Ofrece horas hasta'), unit: t('days ahead', 'días vista'), test: 'booking-window' },
  { key: 'minimumNoticeMinutes' as const, min: 0, max: 10080, label: t('Never sooner than', 'Nunca antes de'), unit: t('minutes from now', 'minutos desde ahora'), test: 'minimum-notice' },
  { key: 'slotsPerReply' as const, min: 1, max: 5, label: t('Times per reply', 'Horas por respuesta'), unit: t('at most', 'como mucho'), test: 'slots-per-reply' },
]

function commit(key: (typeof FIELDS)[number]['key'], event: Event) {
  const field = FIELDS.find((f) => f.key === key)!
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (!Number.isInteger(value) || value < field.min || value > field.max) {
    // Put back what is stored rather than sending something the server
    // refuses and leaving the box showing a number that is not in effect.
    input.value = String(props.config[key])
    return
  }
  if (value !== props.config[key]) props.save({ [key]: value })
}

// What a patient back after a long break, with no bono left, is offered
// (returningPatientSection). Unset, the type of their last visit -- which for
// someone last seen at their report visit a year ago is another report.
function commitReactivation(event: Event) {
  const id = (event.target as HTMLSelectElement).value || null
  if (id !== props.config.reactivationAppointmentTypeId) props.save({ reactivationAppointmentTypeId: id })
}

const mayBook = computed(() => {
  if (!props.config.bookableAppointmentTypeIds.length) return t(`Any active type (${props.offeredTypes.length})`, `Cualquier tipo activo (${props.offeredTypes.length})`)
  return props.offeredTypes.length === 1 ? t('1 appointment type', '1 tipo de cita') : t(`${props.offeredTypes.length} appointment types`, `${props.offeredTypes.length} tipos de cita`)
})
</script>

<template>
  <GrowthSettingCard :title="t('Booking rules', 'Reglas de reserva')">
    <div class="flex flex-col gap-2">
      <label v-for="field in FIELDS" :key="field.key" class="flex items-center justify-between gap-3 text-[11.5px] text-ink-700">
        <span>{{ field.label }}</span>
        <span class="flex shrink-0 items-center gap-1.5">
          <input
            type="number"
            :min="field.min"
            :max="field.max"
            step="1"
            :value="config[field.key]"
            :disabled="saving"
            class="h-8 w-20 rounded-ctl border border-line-control bg-surface px-2 text-right text-[12px] text-ink-700 focus:border-brand focus:outline-none"
            :data-test="field.test"
            @change="commit(field.key, $event)"
          >
          <span class="w-28 text-[11px] text-ink-faint">{{ field.unit }}</span>
        </span>
      </label>
      <label class="flex items-center justify-between gap-3 border-t border-line-divider pt-2 text-[11.5px] text-ink-700">
        <span>{{ t('Back after 6+ months, no package', 'Vuelve tras más de 6 meses, sin bono') }}</span>
        <select
          :value="config.reactivationAppointmentTypeId ?? ''"
          :disabled="saving"
          class="h-8 max-w-[12rem] shrink-0 rounded-ctl border border-line-control bg-surface px-2 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
          data-test="reactivation-type"
          @change="commitReactivation"
        >
          <option value="">{{ t('Same type as their last visit', 'El tipo de su última visita') }}</option>
          <option v-for="type in offeredTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
        </select>
      </label>
      <div class="flex items-baseline justify-between gap-2 border-t border-line-divider pt-2 text-[11.5px]">
        <span class="text-ink-700">{{ t('May offer', 'Puede ofrecer') }}</span>
        <!-- The server's count of what the drafts are given, not the length
        of the stored list: that one counts archived types and reads 0 for
        "any type". -->
        <a href="#bookable-types" class="text-right text-brand-text hover:underline" data-test="may-book-summary">{{ mayBook }} →</a>
      </div>
    </div>
    <p class="text-[10.5px] leading-[1.5] text-ink-muted">
      {{ t(
        'When it drafts, it offers times and a person books. When it answers on its own, it books or moves the visit itself once the patient accepts a time — signed "AI receptionist" in the visit\'s history, with a note in the conversation. It never cancels without asking first.',
        'Cuando redacta, ofrece horas y reserva una persona. Cuando contesta sola, reserva o mueve la cita ella misma cuando el paciente acepta una hora — firmado "Recepcionista IA" en el historial de la cita, con una nota en la conversación. Nunca cancela sin preguntar antes.',
      ) }}
    </p>
  </GrowthSettingCard>
</template>
