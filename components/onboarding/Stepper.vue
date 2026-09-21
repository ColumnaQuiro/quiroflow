<script setup lang="ts">
// The four-step progress indicator, roughly 50px tall, at the top of the
// onboarding shell's left column.
//
// It replaces a numbered-circle stepper that stood taller than the two-field
// form it introduced. Three rows -- a "Step n of 4" line, a hairline segment
// bar, and four labels -- carry the same information in a fraction of the
// height, which is the whole point: the stepper is orientation, not content.
const props = withDefaults(defineProps<{ current: number; nameOverride?: string }>(), {
  nameOverride: undefined,
})

const t = useT()

const TOTAL = 4

// Row 1 names the step in full; row 3 labels it short enough that four of
// them fit a 515px measure. They are separate strings rather than one
// truncated at render, so Spanish can shorten differently from English --
// "Preferencias" does not clip where "Preferences" does.
const stepNames = computed(() => [
  t('Create account', 'Crear cuenta'),
  t('Practice setup', 'Configurar consulta'),
  t('Preferences', 'Preferencias'),
  t('Launch', 'Empezar'),
])

const stepLabels = computed(() => [
  t('Account', 'Cuenta'),
  t('Practice', 'Consulta'),
  t('Preferences', 'Preferencias'),
  t('Launch', 'Empezar'),
])

// Below lg the third label is the only one that cannot hold its width, so it
// gets its own string rather than a substring of the one above -- the short
// form of "Preferencias" is not "Preferen".
const shortLabels = computed(() => [
  t('Account', 'Cuenta'),
  t('Practice', 'Consulta'),
  t('Prefs', 'Prefs'),
  t('Launch', 'Empezar'),
])

const currentName = computed(() => props.nameOverride ?? stepNames.value[props.current - 1] ?? '')
</script>

<template>
  <div class="flex flex-col gap-2 lg:gap-[9px]">
    <!-- Row 1: where you are, in words. Announced on change by the shell. -->
    <p class="flex items-baseline gap-1.5 lg:gap-[7px]">
      <span class="text-[12.5px] font-semibold text-ink-500">{{ t(`Step ${current} of ${TOTAL}`, `Paso ${current} de ${TOTAL}`) }}</span>
      <span aria-hidden="true" class="text-[12.5px] text-ink-faint">·</span>
      <span class="text-[12.5px] text-ink-muted">{{ currentName }}</span>
    </p>

    <!-- Row 2: the bar. Decorative -- row 1 already states the position. -->
    <div aria-hidden="true" class="flex gap-1 lg:gap-[5px]">
      <div
        v-for="n in TOTAL"
        :key="n"
        class="h-[3px] flex-1 rounded-sm"
        :class="n <= current ? 'bg-brand' : 'bg-line'"
      />
    </div>

    <!-- Row 3: the four names, so the shape of the whole flow stays visible. -->
    <ol class="flex gap-1 lg:gap-[5px]">
      <li
        v-for="(label, i) in stepLabels"
        :key="label"
        class="flex flex-1 basis-0 items-center gap-[3px] lg:gap-1"
        :aria-current="i + 1 === current ? 'step' : undefined"
      >
        <svg
          v-if="i + 1 < current"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          class="h-[10px] w-[10px] shrink-0 text-brand-text lg:h-[11px] lg:w-[11px]"
        >
          <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span
          class="truncate text-[11px] lg:text-[11.5px]"
          :class="[
            i + 1 < current && 'font-semibold text-brand-text',
            i + 1 === current && 'font-semibold text-ink-500',
            i + 1 > current && 'text-ink-muted',
          ]"
        >
          <span class="lg:hidden">{{ shortLabels[i] }}</span>
          <span class="hidden lg:inline">{{ label }}</span>
        </span>
      </li>
    </ol>
  </div>
</template>
