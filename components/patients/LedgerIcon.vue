<script setup lang="ts">
// The account ledger's icons: what kind of entry a row is (the tile at its
// start) and what each of its actions does. Stroke-based on a 24px grid so
// they take the colour of the text around them; always decorative, because
// every place that shows one also names it in words.
export type LedgerIconName =
  | 'receipt'
  | 'rectifying'
  | 'money-in'
  | 'money-out'
  | 'bono'
  | 'credit'
  | 'collect'
  | 'open'
  | 'mail'
  | 'write-off'
  | 'trash'
  | 'swap'
  | 'pencil'
  | 'refund'
  | 'transfer'
  | 'dots'
  | 'chevron'

defineProps<{ name: LedgerIconName }>()

const PATHS: Record<LedgerIconName, string> = {
  receipt: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  rectifying: 'M6 3h9l4 4v14H6zM14 3v5h5M11 12l-2 2 2 2M9 14h7',
  'money-in': 'M17 7L7 17M7 9v8h8',
  'money-out': 'M7 17L17 7M9 7h8v8',
  bono: 'M3 9V6h18v3a3 3 0 000 6v3H3v-3a3 3 0 000-6zM14 7v2M14 11v2M14 15v2',
  credit: 'M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H4zM4 7l11-3v3M16 13h1',
  collect: 'M3 8a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 10h18M7 15h3',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  mail: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM3 7l9 6 9-6',
  'write-off': 'M12 4a8 8 0 100 16 8 8 0 000-16zM6.5 17.5l11-11',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  swap: 'M7 4L4 7l3 3M4 7h12a4 4 0 014 4M17 20l3-3-3-3M20 17H8a4 4 0 01-4-4',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  refund: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  transfer: 'M8 5a3 3 0 110 6 3 3 0 010-6zM3 19a5 5 0 0110 0M15 12h6M18 9l3 3-3 3',
  dots: '',
  chevron: 'M9 6l6 6-6 6',
}
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'dots'">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </template>
    <path v-else :d="PATHS[name]" />
  </svg>
</template>
