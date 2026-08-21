<script setup lang="ts">
interface Item {
  to: string
  label: string
  description: string
  icon: string
}
interface Group {
  label: string
  items: Item[]
}

defineProps<{ groups: Group[] }>()
</script>

<template>
  <div class="space-y-9">
    <div v-for="group in groups" :key="group.label">
      <h2 class="text-[15px] font-[620] text-ink-900">{{ group.label }}</h2>
      <div class="mt-3.5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="group flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-brand-tintBorder hover:bg-brand-tintDeep"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
            </svg>
          </span>
          <div class="min-w-0 pt-0.5">
            <p class="text-[13.5px] font-[560] text-ink-700 group-hover:text-brand-text">{{ item.label }}</p>
            <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ item.description }}</p>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
