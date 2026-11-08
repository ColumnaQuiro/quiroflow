<script setup lang="ts">
// "‹ Informes" at the top of every report, back to the list.
//
// It was the text arrow &larr; in nineteen copies of the same link: drawn at
// the font's size and weight (a hairline at 13px), and a 17px-tall target
// beside a 36px button, too small to hit on the front-desk iPad. One
// component, a real chevron and a control-sized hit area.
const t = useT()
</script>

<template>
  <NuxtLink
    to="/reports"
    data-pdf-skip
    class="-ml-1 inline-flex h-9 items-center gap-1 rounded-ctl px-2 text-[13px] font-medium text-ink-muted2 hover:bg-surface-subtle hover:text-ink-600 touch:h-11"
  >
    <UiChevron dir="left" />
    {{ t('Reports', 'Informes') }}
  </NuxtLink>
</template>
