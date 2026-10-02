<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// Settings > Saved Replies: answers the team inserts in the Inbox
// (SavedRepliesPicker) instead of retyping them. Shared by everyone.
//
// The list and the editor sit side by side, where the list used to turn
// into the editor and back. Opening another reply saves the one being
// edited first, so moving between them never loses a change.

type SavedReply = Tables<'saved_replies'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const replies = ref<SavedReply[]>([])
const loading = ref(true)
const activeId = ref<string | null>(null)
const title = ref('')
const body = ref('')
const saving = ref(false)
const query = ref('')

const active = computed(() => replies.value.find((r) => r.id === activeId.value) ?? null)
const dirty = computed(() => !!active.value && (title.value !== active.value.title || body.value !== active.value.body))

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? replies.value.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)) : replies.value
})

async function load() {
  const { data } = await supabase.from('saved_replies').select('*').order('title')
  replies.value = data ?? []
  loading.value = false
  if (!activeId.value && replies.value[0]) openReply(replies.value[0])
}
onMounted(load)

function show(r: SavedReply) {
  activeId.value = r.id
  title.value = r.title
  body.value = r.body
}

// A failed save keeps the reply open with its edits rather than switching
// away and dropping them; a click while a save is in flight is ignored.
async function openReply(r: SavedReply) {
  if (r.id === activeId.value || saving.value) return
  if (dirty.value && !(await save())) return
  show(r)
}

// A second click while the first is still creating made a second
// "Untitled reply".
const creating = ref(false)
async function newReply() {
  if (saving.value || creating.value) return
  if (dirty.value && !(await save())) return
  creating.value = true
  const { data, error } = await supabase
    .from('saved_replies')
    .insert({
      account_id: store.accountId!,
      title: t('Untitled reply', 'Respuesta sin título'),
      body: '',
      created_by: store.teamMember?.id ?? null,
      updated_by: store.teamMember?.id ?? null,
    })
    .select('*')
    .single()
  creating.value = false
  if (error || !data) {
    showToast(error?.message ?? t('Could not create the reply.', 'No se pudo crear la respuesta.'), 'error')
    return
  }
  replies.value = [...replies.value, data].sort((a, b) => a.title.localeCompare(b.title))
  query.value = ''
  show(data)
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy="reply-title"]')?.select())
}

async function save(): Promise<boolean> {
  const r = active.value
  if (!r) return false
  saving.value = true
  const values = { title: title.value.trim() || t('Untitled reply', 'Respuesta sin título'), body: body.value, updated_by: store.teamMember?.id ?? null }
  const { data, error } = await supabase.from('saved_replies').update(values).eq('id', r.id).select('*').single()
  saving.value = false
  if (error || !data) {
    showToast(error?.message ?? t('Could not save.', 'No se pudo guardar.'), 'error')
    return false
  }
  replies.value = replies.value.map((x) => (x.id === r.id ? data : x)).sort((a, b) => a.title.localeCompare(b.title))
  // Only the blank-title fallback is taken back from the row; anything typed
  // while the request was out stays in the box, and stays unsaved.
  if (activeId.value === r.id && !title.value.trim()) title.value = data.title
  showToast(t('Saved', 'Guardado'))
  return true
}

// Asked in an in-app dialog rather than confirm().
const deleting = ref<SavedReply | null>(null)
async function confirmDelete() {
  const r = deleting.value
  if (!r) return
  const { error } = await supabase.from('saved_replies').delete().eq('id', r.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  replies.value = replies.value.filter((x) => x.id !== r.id)
  if (activeId.value === r.id) {
    activeId.value = null
    if (replies.value[0]) show(replies.value[0])
  }
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Saved Replies', 'Respuestas guardadas')">
      <UiBtn variant="primary" data-cy="reply-new" :disabled="creating" @click="newReply">{{ t('New reply', 'Nueva respuesta') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="replies-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Answers the team inserts in the Inbox instead of retyping them: hours, prices, how to find you. Shared by everyone.', 'Respuestas que el equipo inserta en la Bandeja en lugar de reescribirlas: horarios, precios, cómo llegar. Compartidas por todos.') }}
          </p>

          <section class="flex min-h-[560px] flex-col overflow-hidden rounded-card border border-line bg-surface md:flex-row">
            <!-- The list -->
            <div class="flex w-full shrink-0 flex-col border-line max-md:border-b md:w-[320px] md:border-r">
              <div class="p-3.5">
                <label class="flex h-9 touch:h-11 items-center gap-2 rounded-ctl border border-line-control px-3 text-ink-muted">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input v-model="query" type="search" :placeholder="t(`Search ${replies.length} replies`, `Buscar en ${replies.length} respuestas`)" :aria-label="t('Search replies', 'Buscar respuestas')" class="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-900 outline-none" />
                </label>
              </div>
              <template v-if="loading">
                <div v-for="i in 4" :key="i" class="flex flex-col gap-2 border-t border-line-row px-3.5 py-3">
                  <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
                  <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
                </div>
              </template>
              <p v-else-if="replies.length === 0" class="border-t border-line-row px-3.5 py-6 text-center text-[13.5px] text-ink-muted">{{ t('No saved replies yet.', 'Aún no hay respuestas guardadas.') }}</p>
              <p v-else-if="shown.length === 0" class="border-t border-line-row px-3.5 py-6 text-center text-[13.5px] text-ink-muted">{{ t('No reply matches.', 'Ninguna respuesta coincide.') }}</p>
              <ul v-else>
                <li v-for="r in shown" :key="r.id">
                  <button
                    type="button"
                    data-cy="reply-row"
                    :aria-current="r.id === activeId ? 'true' : undefined"
                    class="flex w-full flex-col gap-0.5 border-t border-line-row px-3.5 py-2.5 text-left hover:bg-surface-subtle"
                    :class="r.id === activeId ? 'bg-brand-tint shadow-[inset_3px_0_0_rgb(var(--color-brand))]' : ''"
                    @click="openReply(r)"
                  >
                    <strong class="truncate text-[14px] text-ink-900">{{ r.id === activeId ? title || t('Untitled reply', 'Respuesta sin título') : r.title }}</strong>
                    <span class="truncate text-[12.5px] text-ink-muted">{{ (r.id === activeId ? body : r.body) || t('Empty', 'Vacía') }}</span>
                  </button>
                </li>
              </ul>
            </div>

            <!-- The editor -->
            <div v-if="active" class="flex min-w-0 flex-1 flex-col gap-3.5 p-[18px]" data-cy="reply-editor">
              <div class="flex flex-wrap items-center gap-2.5">
                <span class="flex-1 text-[12.5px] text-ink-muted">
                  {{ dirty ? t('Unsaved changes', 'Cambios sin guardar') : t(`Edited ${new Date(active.updated_at).toLocaleDateString('es-ES')}`, `Editada el ${new Date(active.updated_at).toLocaleDateString('es-ES')}`) }}
                </span>
                <UiBtn class="!border-danger-border !text-danger-text" data-cy="reply-delete" @click="deleting = active">{{ t('Delete', 'Eliminar') }}</UiBtn>
                <UiBtn variant="primary" data-cy="reply-save" :disabled="saving || !dirty" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input v-model="title" type="text" data-cy="reply-title" :placeholder="t('Untitled reply', 'Respuesta sin título')" :class="[inputClass, 'font-normal']" />
              </label>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Message', 'Mensaje') }}
                <textarea
                  v-model="body"
                  rows="7"
                  data-cy="reply-body"
                  :placeholder="t('What should this reply say?', '¿Qué debería decir esta respuesta?')"
                  class="resize-y rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-relaxed text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </label>
              <div v-if="body.trim()" class="flex flex-col gap-2">
                <span class="text-[12.5px] font-semibold text-ink-500">{{ t('In the Inbox', 'En la Bandeja') }}</span>
                <div class="flex justify-end rounded-ctl bg-surface-page p-4">
                  <p class="max-w-[380px] whitespace-pre-line rounded-[12px_12px_4px_12px] bg-brand px-3 py-2.5 text-[13.5px] leading-snug text-white">{{ body }}</p>
                </div>
              </div>
            </div>
            <div v-else-if="!loading" class="flex flex-1 items-center justify-center p-8 text-center text-[14px] text-ink-muted">
              {{ t('Create a reply to start.', 'Crea una respuesta para empezar.') }}
            </div>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.title}”?`, `¿Eliminar «${deleting.title}»?`)"
      :confirm-label="t('Delete reply', 'Eliminar respuesta')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('It disappears from the Inbox for the whole team. Messages already sent with it are not affected.', 'Desaparece de la Bandeja para todo el equipo. Los mensajes ya enviados con ella no cambian.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
