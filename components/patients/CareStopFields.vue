<script setup lang="ts">
import type { CareStopReason } from '~/composables/useCareStopReasons'

// Reason + optional note, for recording why a patient stopped care: in the
// Recalls dismiss dialog (where it is optional) and in CareStopDialog.
defineProps<{ reasons: CareStopReason[]; optional?: boolean }>()
const reasonId = defineModel<string>('reasonId', { required: true })
const note = defineModel<string>('note', { required: true })
const t = useT()
const field = 'h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 focus:border-brand focus:outline-none touch:h-11'
</script>

<template>
  <div class="flex flex-col gap-2.5" data-cy="care-stop-fields">
    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ optional ? t('Why they stopped (optional)', 'Por qué lo deja (opcional)') : t('Why they stopped', 'Por qué lo deja') }}
      <select v-model="reasonId" :class="field" class="font-normal" data-cy="care-stop-reason">
        <option value="">{{ optional ? t('Not known / not said', 'No se sabe / no lo ha dicho') : t('Choose a reason…', 'Elige un motivo…') }}</option>
        <option v-for="r in reasons" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
    </label>
    <label v-if="reasonId" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Note (optional)', 'Nota (opcional)') }}
      <textarea
        v-model="note"
        rows="2"
        maxlength="500"
        :placeholder="t('In their words, if it helps', 'En sus palabras, si ayuda')"
        class="w-full rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none"
        data-cy="care-stop-note"
      />
    </label>
    <p v-if="!reasons.length" class="text-[12.5px] text-ink-muted">{{ t('No reasons set up yet: Settings › Recalls.', 'Aún no hay motivos: Ajustes › Recordatorios.') }}</p>
  </div>
</template>
