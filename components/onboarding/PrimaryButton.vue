<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'submit' | 'button'
    loading?: boolean
    loadingLabel?: string
    /** Step 4's "Get started" is taller -- it is the end of the flow, not a step in it. */
    size?: 'md' | 'lg'
  }>(),
  { type: 'submit', loading: false, loadingLabel: undefined, size: 'md' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="loading"
    :aria-busy="loading || undefined"
    class="flex w-full items-center justify-center gap-2.5 rounded-ctl font-semibold tracking-[-0.006em] text-white outline-none focus-visible:shadow-focus disabled:cursor-wait"
    :class="[
      size === 'lg' ? 'h-12 text-[15px] lg:h-11' : 'h-[46px] text-[15px] lg:h-10 lg:text-[14.5px]',
      loading ? 'bg-brand-hover' : 'bg-brand hover:bg-brand-hover',
    ]"
  >
    <svg v-if="loading" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-4 w-4 animate-spin">
      <circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.8" class="opacity-35" />
      <path d="M8 1.9A6.1 6.1 0 0 1 14.1 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <span><slot v-if="!loading" />{{ loading ? loadingLabel : '' }}</span>
  </button>
</template>
