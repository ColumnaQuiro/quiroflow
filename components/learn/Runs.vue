<script setup lang="ts">
import type { LearnRun } from '../../utils/learnContent'

// A text block's formatted words (utils/learnContent.ts), drawn as elements
// -- never as HTML -- so nothing stored in an article can run in a reader's
// browser. Line breaks inside a block are kept by the parent's
// whitespace-pre-line. Shared with mobile/.
defineProps<{ runs: LearnRun[] }>()

const cls = (r: LearnRun) => [r.bold ? 'font-semibold' : '', r.italic ? 'italic' : '', r.underline && r.strike ? 'underline line-through' : r.underline ? 'underline' : r.strike ? 'line-through' : '']
</script>

<template>
  <template v-for="(r, i) in runs" :key="i">
    <a v-if="r.href" :href="r.href" target="_blank" rel="noopener noreferrer nofollow" class="text-brand-text underline underline-offset-2" :class="cls(r)">{{ r.text }}</a>
    <code v-else-if="r.code" class="rounded-[4px] bg-surface-subtle px-1 py-px font-mono text-[0.88em] text-ink-800" :class="cls(r)">{{ r.text }}</code>
    <span v-else :class="cls(r)">{{ r.text }}</span>
  </template>
</template>
