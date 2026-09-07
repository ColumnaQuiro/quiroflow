<script setup lang="ts">
const props = defineProps<{ code: string; language?: string }>()

const copied = ref(false)
async function copy() {
  await navigator.clipboard.writeText(props.code)
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>
  <div class="group relative my-3">
    <div v-if="language" class="flex items-center justify-between rounded-t-ctl border border-b-0 border-line bg-surface-subtle px-3 py-1.5">
      <span class="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{{ language }}</span>
      <button type="button" class="text-[11.5px] font-medium text-ink-muted2 hover:text-ink-700" @click="copy">
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <button
      v-else
      type="button"
      class="absolute right-2 top-2 rounded-ctlSm border border-line-control bg-surface px-2 py-0.5 text-[11.5px] text-ink-muted2 opacity-0 transition group-hover:opacity-100 hover:text-ink-700"
      @click="copy"
    >
      {{ copied ? 'Copied' : 'Copy' }}
    </button>
    <!-- Deliberately literal colours rather than bg-ink-900/text-white: the
         ink scale inverts between themes, so that pairing renders white text
         on a near-white block in dark mode. Code blocks read best staying
         dark in both themes, which no existing token expresses. -->
    <pre
      class="overflow-x-auto border border-line bg-[rgb(21,23,30)] p-3.5 text-[12.5px] leading-relaxed text-[rgb(236,238,243)]"
      :class="language ? 'rounded-b-ctl' : 'rounded-ctl'"
    ><code>{{ code }}</code></pre>
  </div>
</template>
