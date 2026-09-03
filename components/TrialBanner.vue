<script setup lang="ts">
const store = useAccountStore()
const daysLeft = computed(() => store.trialDaysLeft)

const upgradeHref = computed(() => {
  const subject = encodeURIComponent(`Upgrade my QuiroFlow plan -- ${store.accountName}`)
  return `mailto:hola@columnaquiro.com?subject=${subject}`
})
</script>

<template>
  <div v-if="daysLeft !== null" class="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
    <span>{{ daysLeft === 0 ? 'Trial ends today' : daysLeft === 1 ? '1 day left in your trial' : `${daysLeft} days left in your trial` }}</span>
    <span class="opacity-60">|</span>
    <a :href="upgradeHref" class="underline underline-offset-2 hover:opacity-90">Upgrade now</a>
  </div>
</template>
