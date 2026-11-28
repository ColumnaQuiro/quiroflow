<script setup lang="ts">
import { isLearnTextBlock, learnRunsText, type LearnBlock, type LearnTextBlock } from '../../utils/learnContent'

// An article's body as the patient reads it (utils/learnContent.ts), in
// the app, the portal, the no-login link and the editor's preview. Each
// block is its own element; consecutive list items are one list. Images are
// private (learn-media), so they come signed, as `images`: path → URL.
// Shared with mobile/.
const props = defineProps<{ blocks: LearnBlock[]; images?: Record<string, string> }>()

type Group = { kind: 'list'; id: string; ordered: boolean; items: LearnTextBlock[] } | { kind: 'block'; id: string; block: LearnBlock }

const groups = computed<Group[]>(() => {
  const out: Group[] = []
  for (const b of props.blocks) {
    if (isLearnTextBlock(b) && !learnRunsText(b.runs).trim()) continue
    if (b.type === 'bullet' || b.type === 'number') {
      const ordered = b.type === 'number'
      const last = out[out.length - 1]
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(b)
      else out.push({ kind: 'list', id: b.id, ordered, items: [b] })
    } else out.push({ kind: 'block', id: b.id, block: b })
  }
  return out
})
</script>

<template>
  <div class="flex flex-col gap-3.5 text-[16px] leading-relaxed text-ink-800" data-cy="learn-blocks">
    <template v-for="g in groups" :key="g.id">
      <component :is="g.ordered ? 'ol' : 'ul'" v-if="g.kind === 'list'" class="flex flex-col gap-1.5 pl-6" :class="g.ordered ? 'list-decimal' : 'list-disc'" data-cy="learn-list">
        <li v-for="item in g.items" :key="item.id" class="whitespace-pre-line pl-1 marker:text-ink-muted"><LearnRuns :runs="item.runs" /></li>
      </component>
      <template v-else>
        <h2 v-if="g.block.type === 'heading'" class="mt-3 whitespace-pre-line text-[21px] font-bold leading-snug text-ink-900" data-cy="learn-heading"><LearnRuns :runs="g.block.runs" /></h2>
        <h3 v-else-if="g.block.type === 'subheading'" class="mt-1.5 whitespace-pre-line text-[17.5px] font-semibold leading-snug text-ink-900"><LearnRuns :runs="g.block.runs" /></h3>
        <blockquote v-else-if="g.block.type === 'quote'" class="whitespace-pre-line border-l-[3px] border-line-control pl-4 text-ink-700"><LearnRuns :runs="g.block.runs" /></blockquote>
        <div v-else-if="g.block.type === 'callout'" class="flex gap-3 rounded-card bg-brand-tint px-4 py-3 text-ink-900" data-cy="learn-callout">
          <span aria-hidden="true">💡</span>
          <p class="min-w-0 flex-1 whitespace-pre-line"><LearnRuns :runs="g.block.runs" /></p>
        </div>
        <hr v-else-if="g.block.type === 'divider'" class="my-2 border-line" />
        <figure v-else-if="g.block.type === 'image'" class="my-1 flex flex-col gap-1.5" data-cy="learn-image">
          <img v-if="images?.[g.block.path]" :src="images[g.block.path]" :alt="g.block.caption ?? ''" loading="lazy" class="max-h-[80vh] w-full rounded-card bg-surface-subtle object-contain" />
          <div v-else class="aspect-[4/3] w-full animate-pulse rounded-card bg-surface-subtle" aria-hidden="true" />
          <figcaption v-if="g.block.caption" class="text-center text-[13px] text-ink-muted">{{ g.block.caption }}</figcaption>
        </figure>
        <p v-else-if="g.block.type === 'paragraph'" class="whitespace-pre-line" data-cy="learn-paragraph"><LearnRuns :runs="g.block.runs" /></p>
      </template>
    </template>
  </div>
</template>
