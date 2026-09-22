<script setup lang="ts">
// The per-row overflow menu in the patient list.
//
// Nothing destructive is in here, and that is deliberate: Delete and Merge
// live on the record itself, behind a dialog that can count what goes and
// refuse when a factura makes the delete impossible. A list row is the one
// place a mis-click is most likely -- fifty of them, all the same shape --
// so it only offers ways to go somewhere.
const props = defineProps<{ patientId: string; patientName: string; canContact: boolean }>()

const t = useT()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)

function close(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function onPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close(false)
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

const items = computed(() => [
  { key: 'record', to: `/patients/${props.patientId}`, label: t('Open record', 'Abrir ficha') },
  { key: 'money', to: `/patients/${props.patientId}?tab=billing`, label: t('Open billing', 'Abrir facturación') },
  ...(props.canContact
    ? [{ key: 'messages', to: `/patients/${props.patientId}?tab=communications`, label: t('Open messages', 'Abrir mensajes') }]
    : []),
])
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <button
      ref="trigger"
      type="button"
      :aria-label="`${t('Actions for', 'Acciones para')} ${patientName}`"
      :aria-expanded="open"
      aria-haspopup="menu"
      class="inline-flex h-11 w-11 items-center justify-center rounded-ctlSm text-ink-faint outline-none hover:bg-surface-subtle hover:text-ink-700 focus-visible:shadow-focus lg:h-[26px] lg:w-[26px]"
      @click.stop="open = !open"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="h-[15px] w-[15px]">
        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>

    <div v-if="open" role="menu" class="absolute right-0 top-[30px] z-20 w-[190px] rounded-card border border-line bg-surface py-1 text-left shadow-popover">
      <NuxtLink
        v-for="item in items"
        :key="item.key"
        role="menuitem"
        :to="item.to"
        class="block px-3 py-3 text-[13px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle lg:py-2"
        @click="close(false)"
      >
        {{ item.label }}
      </NuxtLink>
    </div>
  </div>
</template>
