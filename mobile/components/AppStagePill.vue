<script setup lang="ts">
import type { AppointmentStage } from '../../utils/appointmentStage'
import { STAGE_TONE, STAGE_TONE_CLASS } from '../../composables/useAppointmentStage'

// Where a visit stands, as the web calendar's block pill draws it: the same
// stage (utils/appointmentStage), words (useStageLabels), tone and glyph, so
// a visit reads "Llegó 10:02" on the phone and on the desk at once.
// `icon` alone for a tile too narrow for the words; the label stays as the
// title and the accessible name.
const props = withDefaults(defineProps<{ stage: AppointmentStage; arrivedAt?: string | null; icon?: boolean }>(), { arrivedAt: null, icon: false })
const { stageLabel } = useStageLabels()
const label = computed(() => stageLabel(props.stage, props.arrivedAt))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none"
    :class="[STAGE_TONE_CLASS[STAGE_TONE[stage]], icon ? 'p-[2px] text-[10.5px]' : 'px-[7px] py-[3px] text-[11.5px]']"
    :title="label"
    :aria-label="icon ? label : undefined"
    :data-stage="stage"
    data-cy="stage-pill"
  >
    <CalendarStageIcon :stage="stage" />
    <span v-if="!icon">{{ label }}</span>
  </span>
</template>
