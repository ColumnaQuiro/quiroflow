<script setup lang="ts">
// One line on the owner's dashboard pointing at Puesta en marcha (/setup)
// while anything there is still open. Deliberately a line and not a second
// card: a new clinic already has the three first steps above it.
//
// Once a browser has seen the list complete, or the owner hides this, it stops
// asking -- the read behind it (one request since setup_checklist(); it was
// nine) is not worth repeating on every visit to the dashboard of a clinic
// that has finished.

const store = useAccountStore()
const t = useT()
const checklist = useSetupChecklist()
const { loaded, failed, settledCount, total, complete } = checklist

const hidden = ref(true)
const storageKey = () => `setup-progress-hidden:${store.accountId}`

onMounted(async () => {
  try {
    if (localStorage.getItem(storageKey()) === '1') return
  } catch {
    // Storage blocked: show it, and simply do not remember a hide.
  }
  await checklist.load()
  if (complete.value) remember()
  else hidden.value = false
})

function remember() {
  hidden.value = true
  try {
    localStorage.setItem(storageKey(), '1')
  } catch {
    // ignore
  }
}
</script>

<template>
  <div
    v-if="store.isOwner && loaded && !failed && !hidden"
    class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line bg-surface px-4 py-2.5 shadow-card sm:px-5"
    data-cy="setup-progress"
  >
    <div class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-chip-bg" aria-hidden="true">
      <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.round((settledCount / total) * 100)}%` }" />
    </div>
    <!-- Wraps rather than truncating: on a phone the links beside it cut
         this down to "Puesta e…" and hid the count it exists to show. -->
    <p class="min-w-[11rem] flex-1 truncate text-[13px] text-ink-600">
      <span class="font-semibold text-ink-900">{{ t('Getting set up', 'Puesta en marcha') }}</span>
      · {{ t(`${settledCount} of ${total} done`, `${settledCount} de ${total} hechos`) }}
    </p>
    <div class="ml-auto flex shrink-0 items-center gap-3">
      <NuxtLink to="/setup" class="inline-flex h-7 items-center text-[12.5px] font-semibold text-brand-text hover:text-brand-hover touch:h-10" data-cy="setup-progress-open">
        {{ t('See what is left', 'Ver lo que falta') }}
      </NuxtLink>
      <button type="button" class="inline-flex h-7 shrink-0 items-center rounded-ctlSm px-1.5 text-[12px] font-medium text-ink-muted2 hover:bg-surface-subtle hover:text-ink-600 touch:h-10" @click="remember">
        {{ t('Hide', 'Ocultar') }}
      </button>
    </div>
  </div>
</template>
