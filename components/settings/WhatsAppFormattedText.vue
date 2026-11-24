<script setup lang="ts">
import { parseWhatsAppText, type WhatsAppStyle } from '~/utils/whatsappFormatting'

// A message drawn the way WhatsApp draws it: the markers gone and their
// styles on, lists with their bullet or number, quotes with a bar. For the
// template preview, so what the clinic sees is what the patient gets.

const props = defineProps<{ text: string }>()
const lines = computed(() => parseWhatsAppText(props.text))

const STYLE_CLASS: Record<WhatsAppStyle, string> = {
  bold: 'font-bold',
  italic: 'italic',
  strike: 'line-through',
  mono: 'font-mono text-[12px]',
  code: 'rounded-[4px] bg-ink-900/[.07] px-1 font-mono text-[12px]',
}
const classes = (styles: WhatsAppStyle[]) => styles.map((s) => STYLE_CLASS[s])
</script>

<template>
  <div class="whitespace-pre-wrap break-words">
    <template v-for="(line, i) in lines" :key="i">
      <div v-if="line.kind === 'quote'" class="my-0.5 border-l-[3px] border-ink-900/20 pl-2 text-ink-muted" data-cy="wa-preview-quote">
        <span v-for="(r, j) in line.runs" :key="j" :class="classes(r.styles)">{{ r.text }}</span><br v-if="!line.runs.length" />
      </div>
      <div v-else-if="line.kind !== 'text'" class="flex gap-1.5 pl-1" :data-cy="`wa-preview-${line.kind}`">
        <span class="shrink-0" :class="line.kind === 'numbered' ? 'tabular-nums' : ''">{{ line.marker }}</span>
        <span class="min-w-0"><span v-for="(r, j) in line.runs" :key="j" :class="classes(r.styles)">{{ r.text }}</span></span>
      </div>
      <div v-else>
        <span v-for="(r, j) in line.runs" :key="j" :class="classes(r.styles)">{{ r.text }}</span><br v-if="!line.runs.length" />
      </div>
    </template>
  </div>
</template>
