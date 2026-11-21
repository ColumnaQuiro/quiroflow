<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import {
  RECEPTIONIST_BLOCK_PRICE_CENTS,
  RECEPTIONIST_BLOCK_REPLIES,
  RECEPTIONIST_INCLUDED_REPLIES,
  receptionistAllowanceLevel,
  receptionistExtraBlocks,
  receptionistLimitReached,
} from '~/utils/receptionistAllowance'

// This month's replies against what the price includes, and the clinic's own
// ceiling. The numbers come from utils/receptionistAllowance.ts, the same
// place the monthly charge reads them, so this card cannot promise one
// allowance while the invoice applies another.
const props = defineProps<{
  replies: number
  limit: number | null
  /**
   * A trial that has bought nothing: its replies so far of the trial's
   * allowance (RECEPTIONIST_TRIAL_REPLIES), which is what stops it then --
   * nothing is charged in a trial, so the month's included 1,000 say nothing.
   */
  trial?: { used: number; limit: number } | null
  saving: boolean
  save: (limit: number | null) => Promise<boolean>
}>()

const t = useT()

const level = computed(() => receptionistAllowanceLevel(props.replies))
const pct = computed(() => Math.min(100, Math.round((props.replies / RECEPTIONIST_INCLUDED_REPLIES) * 100)))
const barTone = computed(() => (level.value === 'over' ? 'bg-danger-text' : level.value === 'near' ? 'bg-warning-accent' : 'bg-brand'))
const blocks = computed(() => receptionistExtraBlocks(props.replies))
const stopped = computed(() => receptionistLimitReached(props.replies, props.limit))
const trialPct = computed(() => (props.trial ? Math.min(100, Math.round((props.trial.used / props.trial.limit) * 100)) : 0))
const trialUsedUp = computed(() => !!props.trial && props.trial.used >= props.trial.limit)
const included = RECEPTIONIST_INCLUDED_REPLIES.toLocaleString('es-ES')
const blockPrice = formatEur(RECEPTIONIST_BLOCK_PRICE_CENTS)
// The block size written the same way as the allowance beside it. The
// sentences had "1,000" and "1.000" typed in, next to an `included` that
// es-ES prints as "1000".
const block = RECEPTIONIST_BLOCK_REPLIES.toLocaleString('es-ES')

const draft = ref(props.limit ? String(props.limit) : '')
watch(() => props.limit, (v) => (draft.value = v ? String(v) : ''))
const draftValid = computed(() => draft.value === '' || (/^\d+$/.test(draft.value) && Number(draft.value) > 0))

function saveLimit() {
  if (!draftValid.value) return
  props.save(draft.value === '' ? null : Number(draft.value))
}
</script>

<template>
  <GrowthSettingCard :title="trial ? t('Replies in your trial', 'Respuestas de la prueba') : t('Replies this month', 'Respuestas este mes')">
    <div v-if="trial" data-test="receptionist-trial-usage">
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-[13.5px] font-semibold text-ink-900">
          <span data-test="trial-usage-count">{{ trial.used.toLocaleString('es-ES') }}</span>
          <span class="text-[11.5px] font-normal text-ink-muted"> {{ t(`of ${trial.limit} in the free trial`, `de ${trial.limit} en la prueba gratuita`) }}</span>
        </p>
        <span class="text-[11px] text-ink-faint">{{ trialPct }}%</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
        <div class="h-full rounded-pill transition-all" :class="trialUsedUp ? 'bg-danger-text' : trialPct >= 80 ? 'bg-warning-accent' : 'bg-brand'" :style="{ width: `${trialPct}%` }" />
      </div>
      <p v-if="trialUsedUp" class="mt-2 rounded-ctl border border-danger-border bg-danger-bg px-2.5 py-1.5 text-[11.5px] text-danger-text" data-test="trial-usage-over">
        {{ t(
          `The trial's ${trial.limit} replies are used, so it is not drafting or answering. Add it under Subscription and it carries on.`,
          `Se han usado las ${trial.limit} respuestas de la prueba, así que no redacta ni contesta. Añádela en Suscripción y sigue.`,
        ) }}
      </p>
      <p v-else class="mt-2 text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          `The free trial includes ${trial.limit} replies, sent or left as drafts. Once you add it under Subscription, it has ${included} a month, and this month's replies count toward them.`,
          `La prueba gratuita incluye ${trial.limit} respuestas, enviadas o como borrador. Cuando la añadas en Suscripción, tendrá ${included} al mes, y las de este mes cuentan para ellas.`,
        ) }}
      </p>
      <NuxtLink to="/subscription" class="mt-2 inline-flex text-[11.5px] font-semibold text-brand-text hover:text-brand-hover">{{ t('Add it under Subscription →', 'Añadirla en Suscripción →') }}</NuxtLink>
    </div>
    <div v-else data-test="receptionist-usage">
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-[13.5px] font-semibold text-ink-900">
          <span data-test="usage-count">{{ replies.toLocaleString('es-ES') }}</span>
          <span class="text-[11.5px] font-normal text-ink-muted"> {{ t(`of ${included} included`, `de ${included} incluidas`) }}</span>
        </p>
        <span class="text-[11px] text-ink-faint">{{ pct }}%</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
        <div class="h-full rounded-pill transition-all" :class="barTone" :style="{ width: `${pct}%` }" />
      </div>

      <!-- Warned from 80%, so the first a clinic hears of the extra blocks is
      not the invoice. -->
      <p v-if="level === 'near'" class="mt-2 rounded-ctl border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[11.5px] text-warning-text" data-test="usage-near">
        {{ t(
          `Most of this month's ${included} included replies are used. Past them, each further ${block} is ${blockPrice} + IVA.`,
          `Ya se ha usado la mayor parte de las ${included} respuestas incluidas este mes. A partir de ahí, cada ${block} más son ${blockPrice} + IVA.`,
        ) }}
      </p>
      <p v-else-if="level === 'over'" class="mt-2 rounded-ctl border border-danger-border bg-danger-bg px-2.5 py-1.5 text-[11.5px] text-danger-text" data-test="usage-over">
        {{ t(
          `The ${included} included replies are used. ${blocks} extra block${blocks === 1 ? '' : 's'} of ${block} so far this month, ${blockPrice} + IVA each, charged at the start of next month.`,
          `Se han usado las ${included} respuestas incluidas. Este mes van ${blocks} ${blocks === 1 ? 'bloque extra' : 'bloques extra'} de ${block}, a ${blockPrice} + IVA cada uno, que se cobran a principios del mes que viene.`,
        ) }}
      </p>
      <p v-else class="mt-2 text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          `Every reply it writes counts, sent or left as a draft. ${included} a month are included; each further ${block} is ${blockPrice} + IVA.`,
          `Cuenta cada respuesta que escribe, enviada o como borrador. Incluye ${included} al mes; cada ${block} más son ${blockPrice} + IVA.`,
        ) }}
      </p>
    </div>

    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
      <span class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Monthly limit', 'Límite mensual') }}</span>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="draft"
          type="text"
          inputmode="numeric"
          :placeholder="t('No limit', 'Sin límite')"
          :aria-label="t('Monthly limit', 'Límite mensual')"
          class="h-8 touch:h-11 w-28 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
          data-test="usage-limit"
          @keydown.enter="saveLimit"
        >
        <UiBtn variant="secondary" size="sm" :disabled="saving || !draftValid" data-test="usage-limit-save" @click="saveLimit">
          {{ t('Save', 'Guardar') }}
        </UiBtn>
      </div>
      <p class="text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          'Optional. Once this month reaches it, the receptionist writes no more replies until the 1st: leads go to a person, and patients wait for one in the Inbox. Empty means no limit.',
          'Opcional. Cuando el mes lo alcanza, la recepcionista no escribe más respuestas hasta el día 1: los contactos pasan a una persona y los pacientes esperan a una en la Bandeja. Vacío es sin límite.',
        ) }}
      </p>
      <p v-if="stopped" class="text-[11.5px] font-semibold text-danger-text" data-test="usage-stopped">
        {{ t('The limit is reached: it is not writing replies this month.', 'Se ha alcanzado el límite: este mes no escribe respuestas.') }}
      </p>
    </div>
  </GrowthSettingCard>
</template>
