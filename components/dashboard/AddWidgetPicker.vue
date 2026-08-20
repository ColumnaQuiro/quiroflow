<script setup lang="ts">
import { WIDGET_REGISTRY } from '~/utils/dashboardWidgets'

const props = defineProps<{ existingTypes: string[] }>()
const emit = defineEmits<{ add: [type: string]; close: [] }>()

const available = computed(() => WIDGET_REGISTRY.filter((w) => !props.existingTypes.includes(w.type)))
</script>

<template>
  <div class="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">Add Widget</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>
      <p v-if="available.length === 0" class="mt-4 text-sm text-gray-400">All widgets are already on your dashboard.</p>
      <ul v-else class="mt-4 space-y-1">
        <li v-for="w in available" :key="w.type">
          <button
            type="button"
            class="w-full rounded-md border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:border-indigo-300 hover:bg-indigo-50"
            @click="emit('add', w.type)"
          >
            {{ w.label }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
