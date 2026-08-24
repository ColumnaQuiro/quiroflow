<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type SavedReply = Tables<'saved_replies'>

const supabase = useSupabaseClient()
const store = useAccountStore()

const replies = ref<SavedReply[]>([])
const loading = ref(true)
const activeReply = ref<SavedReply | null>(null)
const title = ref('')
const body = ref('')
const saving = ref(false)
const savedAt = ref<Date | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase.from('saved_replies').select('*').order('title')
  replies.value = data ?? []
  loading.value = false
}
onMounted(load)

function openReply(r: SavedReply) {
  activeReply.value = r
  title.value = r.title
  body.value = r.body
  savedAt.value = null
}

async function newReply() {
  const { data, error } = await supabase
    .from('saved_replies')
    .insert({
      account_id: store.accountId!,
      title: 'Untitled reply',
      body: '',
      created_by: store.teamMember?.id ?? null,
      updated_by: store.teamMember?.id ?? null,
    })
    .select('*')
    .single()
  if (error || !data) return
  replies.value = [...replies.value, data].sort((a, b) => a.title.localeCompare(b.title))
  openReply(data)
}

function backToList() {
  activeReply.value = null
  load()
}

async function save() {
  if (!activeReply.value) return
  saving.value = true
  const { error } = await supabase
    .from('saved_replies')
    .update({
      title: title.value.trim() || 'Untitled reply',
      body: body.value,
      updated_by: store.teamMember?.id ?? null,
    })
    .eq('id', activeReply.value.id)
  saving.value = false
  if (!error) savedAt.value = new Date()
}

async function removeReply(r: SavedReply) {
  if (!confirm(`Delete "${r.title}"?`)) return
  await supabase.from('saved_replies').delete().eq('id', r.id)
  replies.value = replies.value.filter((x) => x.id !== r.id)
  if (activeReply.value?.id === r.id) activeReply.value = null
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Saved Replies" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            Pre-written answers your team can insert into the Inbox composer instead of retyping common replies
            (hours, pricing, availability, etc.). Shared across the whole team.
          </p>

          <div class="mt-6 rounded-card border border-line bg-surface shadow-card">
            <template v-if="!activeReply">
              <div class="flex items-center justify-between border-b border-line-divider p-4">
                <h3 class="text-[13.5px] font-[560] text-ink-700">Replies</h3>
                <UiBtn variant="primary" size="sm" @click="newReply">+ New Reply</UiBtn>
              </div>
              <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
              <div v-else-if="replies.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No saved replies yet.</div>
              <ul v-else class="divide-y divide-line-row">
                <li v-for="r in replies" :key="r.id" class="flex items-center justify-between gap-3 px-4 py-3">
                  <button type="button" class="min-w-0 flex-1 text-left" @click="openReply(r)">
                    <p class="text-[13.5px] font-[560] text-ink-700 hover:text-brand-text">{{ r.title }}</p>
                    <p class="truncate text-[12.5px] text-ink-muted2">{{ r.body || 'Empty' }}</p>
                  </button>
                  <button type="button" class="shrink-0 text-[12.5px] text-danger-text hover:text-danger-text/80" @click="removeReply(r)">Delete</button>
                </li>
              </ul>
            </template>

            <template v-else>
              <div class="flex items-center justify-between border-b border-line-divider p-4">
                <button type="button" class="text-[13px] text-ink-muted2 hover:text-ink-600" @click="backToList">&larr; Replies</button>
                <div class="flex items-center gap-3">
                  <span v-if="savedAt" class="text-[12.5px] text-success-text">Saved</span>
                  <UiBtn variant="primary" size="sm" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</UiBtn>
                </div>
              </div>

              <div class="p-4">
                <input
                  v-model="title"
                  type="text"
                  placeholder="Untitled reply"
                  class="mb-3 w-full border-none text-[18px] font-semibold text-ink-900 placeholder-ink-faint3 focus:outline-none focus:ring-0"
                />
                <textarea
                  v-model="body"
                  rows="6"
                  placeholder="What should this reply say?"
                  class="w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
