<script setup lang="ts">
export interface Param {
  name: string
  type: string
  required?: boolean
  description: string
}
defineProps<{ params: Param[]; title?: string }>()
</script>

<template>
  <div class="my-4">
    <p v-if="title" class="mb-1.5 text-[12.5px] font-[560] text-ink-700">{{ title }}</p>
    <div class="overflow-hidden rounded-card border border-line">
      <table class="w-full text-[12.5px]">
        <tbody class="divide-y divide-line-row">
          <tr v-for="param in params" :key="param.name" class="align-top">
            <td class="w-[30%] px-3 py-2">
              <code class="font-mono text-[12px] text-ink-900">{{ param.name }}</code>
              <span v-if="param.required" class="ml-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-danger-text">required</span>
              <p class="mt-0.5 font-mono text-[11px] text-ink-faint">{{ param.type }}</p>
            </td>
            <td class="px-3 py-2 leading-relaxed text-ink-muted2">
              <!-- eslint-disable-next-line vue/no-v-html -- authored copy, not user input -->
              <span v-html="param.description" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
