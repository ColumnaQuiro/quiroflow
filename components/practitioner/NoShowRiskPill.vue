<script setup lang="ts">
import { noShowRiskReason, type NoShowRisk } from '../../utils/noShowRisk'

// A visit's no-show risk beside the patient's name: nothing for someone who
// turns up, so the pill only appears where it is worth a phone call.
const props = defineProps<{ risk: NoShowRisk | null | undefined }>()
const t = useT()
const label = computed(() => {
  const r = props.risk
  if (!r || r.level === 'none') return ''
  if (r.level === 'new') return t('First visit', 'Primera visita')
  return r.level === 'high' ? t('No-show risk', 'Riesgo de ausencia') : t('Missed one', 'Faltó una vez')
})
// A first visit is not a mark against anyone: brand, not a warning colour.
const tone = computed(() => (props.risk?.level === 'high' ? 'danger' : props.risk?.level === 'new' ? 'brand' : 'warning'))
</script>

<template>
  <UiPill
    v-if="label"
    :tone="tone"
    class="shrink-0 whitespace-nowrap"
    :title="risk ? noShowRiskReason(risk, t) : ''"
    data-cy="no-show-risk"
    :data-level="risk?.level"
  >{{ label }}</UiPill>
</template>
