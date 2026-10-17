<script setup lang="ts">
import { articleParagraphs, videoEmbedUrl } from '../../utils/learn'

// One education article as a patient reads it -- in the app, the portal and
// the no-login link (pages/aprende). The text is shown as text, paragraph by
// paragraph, never as HTML; a video is framed only when it is YouTube or
// Vimeo (utils/learn.ts), anything else is a plain link.
const props = defineProps<{
  title: string
  summary?: string | null
  body: string
  videoUrl?: string | null
  minutes?: number | null
  clinicName?: string | null
}>()

const paragraphs = computed(() => articleParagraphs(props.body))
const embed = computed(() => videoEmbedUrl(props.videoUrl))
</script>

<template>
  <article class="flex flex-col gap-4" data-cy="learn-article">
    <div class="flex flex-col gap-1">
      <p v-if="clinicName || minutes" class="text-[12.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">
        {{ [clinicName, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ') }}
      </p>
      <h1 class="text-[22px] font-bold leading-tight text-ink-900">{{ title }}</h1>
      <p v-if="summary" class="text-[15px] text-ink-500">{{ summary }}</p>
    </div>
    <div v-if="embed" class="relative w-full overflow-hidden rounded-card bg-ink-900" style="padding-top: 56.25%">
      <iframe :src="embed" :title="title" class="absolute inset-0 h-full w-full" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin" data-cy="learn-video" />
    </div>
    <a v-else-if="videoUrl" :href="videoUrl" target="_blank" rel="noopener noreferrer" class="text-[15px] font-semibold text-brand-text underline">Ver el vídeo</a>
    <p v-for="(p, i) in paragraphs" :key="i" class="whitespace-pre-line text-[16px] leading-relaxed text-ink-800" data-cy="learn-paragraph">{{ p }}</p>
    <slot />
  </article>
</template>
