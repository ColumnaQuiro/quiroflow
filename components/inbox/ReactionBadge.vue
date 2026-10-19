<script setup lang="ts">
// The patient's reaction to a message, drawn the way WhatsApp draws it: a
// small round chip hanging off the bottom of the bubble it reacts to, on the
// bubble's outer side. The bubble's wrapper must be `relative`, with room
// below it for the chip (it overlaps the bubble's edge by half its height).
// Shared by the web Inbox, its lead threads and the staff app's Inbox.
defineProps<{ emoji: string; side: 'left' | 'right' }>()
const t = useT()
</script>

<template>
  <span
    class="pointer-events-none absolute -bottom-[14px] z-[1] flex h-[24px] min-w-[24px] items-center justify-center rounded-pill border border-line bg-surface px-1.5 text-[14px] leading-none shadow-card"
    :class="side === 'right' ? 'right-2' : 'left-2'"
    role="img"
    :aria-label="t(`Reacted with ${emoji}`, `Ha reaccionado con ${emoji}`)"
    data-cy="message-reaction"
  >{{ emoji }}</span>
</template>
