<script setup lang="ts">
import { PREVIEW_APPOINTMENTS, PREVIEW_DAYS, PREVIEW_SLOTS, PREVIEW_WEEK } from './previewFixtures'

const t = useT()

const TONE = {
  brand: { box: 'bg-brand-tint border-brand-tintBorder', dot: 'bg-brand' },
  success: { box: 'bg-success-bg border-success-border', dot: 'bg-success-text' },
  neutral: { box: 'bg-surface-subtle border-line', dot: 'bg-ink-faint' },
}

function at(day: number, slot: number) {
  return PREVIEW_APPOINTMENTS.find((a) => a.day === day && a.slot === slot)
}
</script>

<template>
  <OnboardingPreview
    :eyebrow="t(`A look at what you're setting up`, 'Un vistazo a lo que estás montando')"
    :title="t('Every appointment knows its clinic and its room', 'Cada cita sabe en qué clínica y en qué sala está')"
    :body="
      t(
        'Valencia and Madrid keep separate calendars, separate rooms, one shared patient history.',
        'Valencia y Madrid tienen agendas y salas separadas, y un único historial compartido.',
      )
    "
  >
    <OnboardingPreviewFragment :top="246" :width="760">
      <div class="flex items-center gap-3 border-b border-line-divider px-4 py-[13px]">
        <span class="text-[14px] font-semibold text-ink-900">{{ t(PREVIEW_WEEK.label, PREVIEW_WEEK.labelEs) }}</span>
        <span class="text-[12.5px] text-ink-muted">Valencia</span>
        <span class="flex-1" />
        <span class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2.5 py-[3px] text-[11.5px] font-semibold text-brand-text">Sala 1</span>
        <span class="rounded-pill border border-line bg-surface-subtle px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-500">Sala 2</span>
      </div>

      <div class="grid" style="grid-template-columns: 54px repeat(5, minmax(0, 1fr))">
        <div class="h-[34px] border-b border-line-divider" />
        <div
          v-for="day in PREVIEW_DAYS"
          :key="day.date"
          class="flex h-[34px] items-center gap-[5px] border-b border-l border-line-divider pl-[9px]"
        >
          <span class="text-[12px] font-semibold text-ink-900">{{ t(day.name, day.nameEs) }}</span>
          <span class="text-[12px] text-ink-muted">{{ day.date }}</span>
        </div>

        <template v-for="(slot, row) in PREVIEW_SLOTS" :key="slot">
          <div class="h-[62px] pr-2 pt-[5px] text-right" :class="row < PREVIEW_SLOTS.length - 1 && 'border-b border-line-divider'">
            <span class="text-[11px] text-ink-muted">{{ slot }}</span>
          </div>
          <div
            v-for="(day, col) in PREVIEW_DAYS"
            :key="day.date"
            class="h-[62px] border-l border-line-divider p-1"
            :class="row < PREVIEW_SLOTS.length - 1 && 'border-b'"
          >
            <div
              v-if="at(col, row)"
              class="flex h-full flex-col gap-[3px] rounded-ctlSm border px-2 py-1.5"
              :class="TONE[at(col, row)!.tone].box"
            >
              <div class="flex items-center gap-[5px]">
                <span class="h-[5px] w-[5px] shrink-0 rounded-full" :class="TONE[at(col, row)!.tone].dot" />
                <span class="truncate text-[11.5px] font-semibold text-ink-900">{{ at(col, row)!.patient }}</span>
              </div>
              <span class="truncate text-[11px] text-ink-500">{{ at(col, row)!.detail }}</span>
            </div>
          </div>
        </template>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
