<script setup lang="ts">
// The patient side's header: the clinic's name, not QuiroFlow's. A patient
// signs in to their clinic; that QuiroFlow runs it is a footnote. Initials
// stand in for a logo -- nothing a signed-out visitor can read stores one.
const props = defineProps<{ name?: string }>()
const t = useT()

const initials = computed(() =>
  (props.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <div v-if="name" class="flex min-w-0 items-center gap-[9px]">
    <span
      aria-hidden="true"
      class="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-ctl bg-brand text-[11px] font-bold text-white"
    >{{ initials }}</span>
    <span class="truncate text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ name }}</span>
  </div>
  <div v-else class="flex items-center gap-[9px]">
    <img src="/logo/quiroflow-mark.svg" alt="" class="h-[26px] w-[26px]" />
    <span class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Patient portal', 'Espacio del paciente') }}</span>
  </div>
</template>
