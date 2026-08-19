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
  <div class="space-y-10">
    <div v-for="group in groups" :key="group.label">
      <h2 class="text-base font-semibold text-gray-900">{{ group.label }}</h2>
      <div class="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink v-for="item in group.items" :key="item.to" :to="item.to" class="group flex items-start gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
            </svg>
          </span>
          <div class="min-w-0 pt-1">
            <p class="text-sm font-semibold text-indigo-600 group-hover:text-indigo-700">{{ item.label }}</p>
            <p class="mt-0.5 text-sm text-gray-500">{{ item.description }}</p>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
