<script setup lang="ts">
// The patient side's header: the clinic's name, not QuiroFlow's. A patient
// signs in to their clinic; that QuiroFlow runs it is a footnote. Initials
// stand in for a logo, unless the clinic has its own look for the patient app
// (useClinicBrand): then it is the clinic's logo and the name it goes by.
const props = defineProps<{ name?: string }>()
const t = useT()
const { brand } = useClinicBrand()
const shownName = computed(() => (props.name ? (brand.value?.name ?? props.name) : undefined))

const initials = computed(() =>
  (shownName.value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <div v-if="shownName" class="flex min-w-0 items-center gap-[9px]">
    <img v-if="brand?.logoUrl" :src="brand.logoUrl" alt="" class="h-[28px] w-[28px] shrink-0 rounded-ctl object-contain" data-testid="clinic-brand-logo" />
    <span
      v-else
      aria-hidden="true"
      class="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-ctl bg-brand text-[11px] font-bold text-brand-on"
    >{{ initials }}</span>
    <span class="truncate text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ shownName }}</span>
  </div>
  <div v-else class="flex items-center gap-[9px]">
    <img src="/logo/quiroflow-mark.svg" alt="" class="h-[26px] w-[26px]" />
    <span class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Patient portal', 'Espacio del paciente') }}</span>
  </div>
</template>
