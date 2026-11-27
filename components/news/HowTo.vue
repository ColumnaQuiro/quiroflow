<script setup lang="ts">
import type { NewsEntry } from '../../utils/productNews'

// "How to do it" under a Novedades entry: its steps, numbered, and a button to
// the screen it lives on. `boxed` is the expanded row in the list; a featured
// card shows the button alone, its body having already said what it does.
defineProps<{ entry: NewsEntry; boxed?: boolean }>()
const t = useT()
</script>

<template>
  <div :class="boxed && 'flex flex-col gap-2 rounded-ctl border border-line-divider bg-surface-subtle px-3.5 py-3'" :data-cy="`news-howto-${entry.id}`">
    <template v-if="boxed && entry.steps?.length">
      <p class="text-[11px] font-[640] uppercase tracking-[0.07em] text-ink-faint">{{ t('How to do it', 'Cómo hacerlo') }}</p>
      <ol class="flex flex-col gap-1.5">
        <li v-for="(step, i) in entry.steps" :key="i" class="flex items-baseline gap-2.5 text-[12.5px] text-ink-600">
          <span class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-line-control bg-surface font-mono text-[11px] font-semibold text-ink-500">{{ i + 1 }}</span>
          <span>{{ t(...step) }}</span>
        </li>
      </ol>
    </template>
    <NuxtLink
      v-if="entry.where"
      :to="entry.where.to"
      :data-cy="`news-go-${entry.id}`"
      class="inline-flex h-8 items-center self-start rounded-ctl border px-3 text-[12.5px] touch:h-11"
      :class="boxed ? 'border-brand bg-brand font-semibold text-brand-on hover:bg-brand-hover' : 'border-line-control bg-surface font-medium text-ink-500 hover:border-line-controlHover'"
    >
      {{ t('Go there', 'Ir allí') }}
    </NuxtLink>
  </div>
</template>
