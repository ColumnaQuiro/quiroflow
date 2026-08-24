<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type SavedReply = Tables<'saved_replies'>

withDefaults(defineProps<{ size?: 'sm' | 'lg' }>(), { size: 'sm' })
const emit = defineEmits<{ insert: [text: string] }>()

const supabase = useSupabaseClient()
const replies = ref<SavedReply[]>([])
const loaded = ref(false)
const open = ref(false)

async function load() {
  if (loaded.value) return
  const { data } = await supabase.from('saved_replies').select('id, title, body').order('title')
  replies.value = (data as SavedReply[]) ?? []
  loaded.value = true
}

function toggle() {
  open.value = !open.value
  if (open.value) load()
}

function pick(r: SavedReply) {
  emit('insert', r.body)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex shrink-0 items-center justify-center rounded-ctl border border-line-control text-ink-500 hover:bg-surface-subtle"
      :class="size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'"
      title="Saved replies"
      @click="toggle"
    >
      <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
        />
      </svg>
    </button>

    <div v-if="open" class="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-ctl border border-line bg-surface py-1 shadow-popover">
      <p v-if="replies.length === 0" class="px-3 py-2 text-[12.5px] text-ink-faint">No saved replies yet — add some in Settings &rarr; Saved Replies.</p>
      <button
        v-for="r in replies"
        :key="r.id"
        type="button"
        class="block w-full px-3 py-1.5 text-left hover:bg-surface-subtle"
        @click="pick(r)"
      >
        <p class="text-[13px] font-[560] text-ink-700">{{ r.title }}</p>
        <p class="truncate text-[12px] text-ink-muted2">{{ r.body }}</p>
      </button>
    </div>
  </div>
</template>
