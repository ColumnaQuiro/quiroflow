<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const success = computed(() => route.query.status !== 'cancelled')
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="max-w-sm text-center">
      <p class="text-[15px] font-medium text-ink-900">{{ success ? 'Card saved' : 'Card not saved' }}</p>
      <p class="mt-1.5 text-[13px] text-ink-muted2">
        {{ success ? 'Thanks -- your card has been saved. You can close this window now.' : 'No card was saved. You can close this window and try the link again if you\'d like to add one.' }}
      </p>
    </div>
  </div>
</template>
