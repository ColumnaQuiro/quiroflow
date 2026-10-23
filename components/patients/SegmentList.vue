<script setup lang="ts">
import type { PatientSegment } from '~/composables/usePatientSegments'

// The saved segments beside the patient list, each with how many patients it
// holds now. A column on a wide screen; on a narrow one a row of chips above
// the toolbar that scrolls sideways, so it never pushes the list off screen.
defineProps<{
  segments: PatientSegment[]
  counts: Record<string, number>
  activeId: string | null
  loaded: boolean
  counting: boolean
}>()
const emit = defineEmits<{ open: [segment: PatientSegment]; all: [] }>()
const t = useT()
</script>

<template>
  <nav :aria-label="t('Segments', 'Segmentos')" data-cy="segment-list" class="2xl:w-[210px] 2xl:shrink-0">
    <p class="mb-1.5 hidden px-2 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint 2xl:block">{{ t('Segments', 'Segmentos') }}</p>
    <ul class="flex gap-1.5 overflow-x-auto pb-1 2xl:flex-col 2xl:gap-0.5 2xl:overflow-visible 2xl:pb-0">
      <li class="shrink-0">
        <button
          type="button"
          :aria-current="activeId === null ? 'true' : undefined"
          class="flex h-8 w-full items-center gap-2 rounded-ctl px-2.5 text-left text-[13px] outline-none focus-visible:shadow-focus max-2xl:rounded-pill max-2xl:border"
          :class="activeId === null ? 'bg-brand-tint font-[600] text-brand-text max-2xl:border-brand-tintBorder' : 'text-ink-600 hover:bg-surface-subtle max-2xl:border-line-control max-2xl:bg-surface'"
          @click="emit('all')"
        >
          {{ t('All patients', 'Todos los pacientes') }}
        </button>
      </li>
      <li v-for="segment in segments" :key="segment.id" class="shrink-0">
        <button
          type="button"
          data-cy="segment-item"
          :aria-current="activeId === segment.id ? 'true' : undefined"
          class="flex h-8 w-full items-center gap-2 rounded-ctl px-2.5 text-left text-[13px] outline-none focus-visible:shadow-focus max-2xl:rounded-pill max-2xl:border"
          :class="activeId === segment.id ? 'bg-brand-tint font-[600] text-brand-text max-2xl:border-brand-tintBorder' : 'text-ink-600 hover:bg-surface-subtle max-2xl:border-line-control max-2xl:bg-surface'"
          @click="emit('open', segment)"
        >
          <span class="min-w-0 flex-1 truncate">{{ segment.name }}</span>
          <svg v-if="!segment.shared" viewBox="0 0 12 12" class="h-3 w-3 shrink-0 text-ink-faint" role="img" :aria-label="t('Private', 'Privado')">
            <title>{{ t('Only you can see this segment', 'Solo tú ves este segmento') }}</title>
            <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
            <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.2" />
          </svg>
          <span
            data-cy="segment-count"
            class="shrink-0 font-mono text-[11.5px] text-ink-muted2 transition-opacity"
            :class="counting ? 'opacity-50' : ''"
          >{{ counts[segment.id] ?? '…' }}</span>
        </button>
      </li>
    </ul>
    <p v-if="loaded && segments.length === 0" class="mt-2 hidden px-2 text-[12px] leading-snug text-ink-faint 2xl:block">
      {{ t('Filter the list and save it as a segment to come back to it in one click.', 'Filtra la lista y guárdala como segmento para volver a ella con un clic.') }}
    </p>
  </nav>
</template>
