<script setup lang="ts">
import { videoEmbedUrl } from '../../utils/learn'
import { learnContentFromBody, normalizeLearnContent, type LearnBlock } from '../../utils/learnContent'

// One education article as a patient reads it -- in the app, the portal and
// the no-login link (pages/aprende), and the editor's preview. The body is
// blocks (utils/learnContent.ts, drawn by LearnBlocks, never as HTML); an
// article written before blocks existed has only its plain-text body, read
// as paragraphs. A video is framed only when it is YouTube or Vimeo
// (utils/learn.ts), anything else is a plain link. The clinic's own
// uploaded video comes as `mediaSrc`, its cover as `coverSrc` and the
// images in its text as `images` (path → URL), all signed.
const props = defineProps<{
  title: string
  summary?: string | null
  body?: string | null
  content?: LearnBlock[] | null
  images?: Record<string, string>
  coverSrc?: string | null
  mediaSrc?: string | null
  videoUrl?: string | null
  minutes?: number | null
  clinicName?: string | null
}>()

const blocks = computed(() => {
  const content = normalizeLearnContent(props.content ?? [])
  return content.length ? content : learnContentFromBody(props.body)
})
const embed = computed(() => videoEmbedUrl(props.videoUrl))
</script>

<template>
  <article class="flex flex-col gap-4" data-cy="learn-article">
    <img v-if="coverSrc" :src="coverSrc" alt="" class="aspect-[16/9] w-full rounded-card bg-surface-subtle object-cover" data-cy="learn-cover" />
    <div class="flex flex-col gap-1">
      <p v-if="clinicName || minutes" class="text-[12.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">
        {{ [clinicName, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ') }}
      </p>
      <h1 class="text-[22px] font-bold leading-tight text-ink-900">{{ title }}</h1>
      <p v-if="summary" class="text-[15px] text-ink-500">{{ summary }}</p>
    </div>
    <video v-if="mediaSrc" :src="mediaSrc" controls playsinline preload="metadata" class="max-h-[70vh] w-full rounded-card bg-black object-contain" data-cy="learn-media" />
    <div v-if="embed" class="relative w-full overflow-hidden rounded-card bg-ink-900" style="padding-top: 56.25%">
      <iframe :src="embed" :title="title" class="absolute inset-0 h-full w-full" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin" data-cy="learn-video" />
    </div>
    <a v-else-if="videoUrl" :href="videoUrl" target="_blank" rel="noopener noreferrer" class="text-[15px] font-semibold text-brand-text underline">Ver el vídeo</a>
    <LearnBlocks v-if="blocks.length" :blocks="blocks" :images="images" />
    <slot />
  </article>
</template>
