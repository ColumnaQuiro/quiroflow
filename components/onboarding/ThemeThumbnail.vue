<script setup lang="ts">
// The miniature app window on each Appearance tile.
//
// Like CountryFlag, this file is a deliberate exception to the "theme tokens
// only" rule, and for the same reason: it DEPICTS a palette rather than
// wearing one. A Light thumbnail drawn from tokens would turn dark the moment
// someone picked Dark, leaving three identical swatches and no way to tell the
// options apart -- which is the one thing this control exists to do.
//
// The values are the app's own light and dark surfaces, copied deliberately.
defineProps<{ variant: 'light' | 'dark' | 'system' }>()
</script>

<template>
  <div
    v-if="variant !== 'system'"
    class="flex h-[66px] w-full gap-1.5 rounded-ctlSm border p-[7px]"
    :style="
      variant === 'light'
        ? 'background:#FFFFFF;border-color:#E8E9ED'
        : 'background:#16181F;border-color:#2E323D'
    "
  >
    <div class="w-[26px] rounded" :style="variant === 'light' ? 'background:#F7F8FA' : 'background:#21242C'" />
    <div class="flex flex-1 flex-col gap-[5px]">
      <div class="h-[7px] rounded-sm" :style="variant === 'light' ? 'background:#E8E9ED' : 'background:#3A3F52'" />
      <div class="h-[7px] w-[70%] rounded-sm" :style="variant === 'light' ? 'background:#F0F1F4' : 'background:#2E323D'" />
      <div class="h-[7px] w-[55%] rounded-sm" :style="variant === 'light' ? 'background:#F0F1F4' : 'background:#2E323D'" />
    </div>
  </div>

  <!-- System is split down the middle: it is both, and follows the device. -->
  <div v-else class="flex h-[66px] w-full overflow-hidden rounded-ctlSm border" style="border-color: #e8e9ed">
    <div class="flex w-1/2 flex-col gap-[5px] p-[7px]" style="background: #ffffff">
      <div class="h-[7px] rounded-sm" style="background: #e8e9ed" />
      <div class="h-[7px] w-[72%] rounded-sm" style="background: #f0f1f4" />
    </div>
    <div class="flex w-1/2 flex-col gap-[5px] p-[7px]" style="background: #16181f">
      <div class="h-[7px] rounded-sm" style="background: #3a3f52" />
      <div class="h-[7px] w-[72%] rounded-sm" style="background: #2e323d" />
    </div>
  </div>
</template>
