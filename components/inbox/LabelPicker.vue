<script setup lang="ts">
interface LabelOption {
  id: string
  name: string
  color: string
}

// appliedIds is a plain array rather than a Set to keep the prop simple to
// pass from a plain-object v-for context (a Set prop would need casting at
// every call site); toggle-label emits by id and the parent (which already
// owns myLabelsByKey/insert/delete against whatsapp_conversation_labels)
// decides what "applying" actually means for one conversation vs. a bulk
// selection -- this component only presents the shared catalog and reports
// clicks, it never talks to Supabase directly.
const props = defineProps<{ labels: LabelOption[]; appliedIds: string[] }>()
const emit = defineEmits<{ 'toggle-label': [labelId: string]; 'create-label': [name: string, color: string] }>()

const open = ref(false)
const newName = ref('')
const newColor = ref('#4C6FEB')

function isApplied(id: string) {
  return props.appliedIds.includes(id)
}

function submitNewLabel() {
  const name = newName.value.trim()
  if (!name) return
  emit('create-label', name, newColor.value)
  newName.value = ''
  newColor.value = '#4C6FEB'
}

const rootEl = ref<HTMLElement | null>(null)
function onClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="rootEl" class="relative">
    <button type="button" class="shrink-0 text-[12.5px] text-ink-muted hover:text-ink-700" @click="open = !open">
      Labels<template v-if="appliedIds.length"> ({{ appliedIds.length }})</template>
    </button>

    <div v-if="open" class="absolute right-0 top-[calc(100%+4px)] z-20 w-64 rounded-ctl border border-line bg-surface p-2 shadow-popover">
      <p v-if="labels.length === 0" class="px-1 py-1 text-[12.5px] text-ink-faint">No labels yet -- add one below.</p>
      <button
        v-for="l in labels"
        :key="l.id"
        type="button"
        class="flex w-full items-center gap-2 rounded-ctlSm px-1.5 py-1.5 text-left hover:bg-surface-subtle"
        @click="emit('toggle-label', l.id)"
      >
        <span
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
          :class="isApplied(l.id) ? 'border-transparent' : 'border-line-control'"
          :style="isApplied(l.id) ? { backgroundColor: l.color } : {}"
        >
          <svg v-if="isApplied(l.id)" viewBox="0 0 16 16" class="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8l3.5 3.5L13 5" />
          </svg>
        </span>
        <span class="h-[8px] w-[8px] shrink-0 rounded-full" :style="{ backgroundColor: l.color }" />
        <span class="flex-1 truncate text-[13px] text-ink-700">{{ l.name }}</span>
      </button>

      <div class="mt-1.5 flex items-center gap-1.5 border-t border-line-divider pt-1.5">
        <input v-model="newColor" type="color" class="h-7 w-8 shrink-0 rounded-ctlSm border border-line-control" title="Label color" />
        <input
          v-model="newName"
          type="text"
          placeholder="New label…"
          class="h-7 min-w-0 flex-1 rounded-ctlSm border border-line-control bg-surface px-2 text-[12.5px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none"
          @keydown.enter.prevent="submitNewLabel"
        />
        <button type="button" class="shrink-0 text-[12px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-40" :disabled="!newName.trim()" @click="submitNewLabel">
          Add
        </button>
      </div>
    </div>
  </div>
</template>
