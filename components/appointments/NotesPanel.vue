<script setup lang="ts">
interface VisitNote {
  id: string
  body: string
  created_at: string
}

const props = defineProps<{ appointmentId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const notes = ref<VisitNote[]>([])
const newNote = ref('')
const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('visit_notes')
    .select('id, body, created_at')
    .eq('appointment_id', props.appointmentId)
    .order('created_at', { ascending: false })
  notes.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addNote() {
  if (!newNote.value.trim()) return
  saving.value = true
  await supabase.from('visit_notes').insert({
    account_id: store.accountId!,
    appointment_id: props.appointmentId,
    body: newNote.value.trim(),
    created_by: store.teamMember?.id ?? null,
  })
  newNote.value = ''
  saving.value = false
  await load()
}

async function removeNote(id: string) {
  await supabase.from('visit_notes').delete().eq('id', id)
  notes.value = notes.value.filter((n) => n.id !== id)
}
</script>

<template>
  <div>
    <p v-if="loading" class="text-sm text-gray-400">{{ t('Loading…', 'Cargando…') }}</p>
    <ul v-else-if="notes.length > 0" class="space-y-2">
      <li v-for="note in notes" :key="note.id" class="group relative rounded-md bg-amber-50 p-2 pr-7 text-sm text-gray-800">
        <p class="whitespace-pre-wrap">{{ note.body }}</p>
        <p class="mt-1 text-xs text-gray-400">{{ new Date(note.created_at).toLocaleString() }}</p>
        <button
          type="button"
          class="absolute right-1.5 top-1.5 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
          :title="t('Delete note', 'Eliminar nota')"
          @click="removeNote(note.id)"
        >
          ✕
        </button>
      </li>
    </ul>
    <div class="mt-3 flex gap-2">
      <input
        v-model="newNote"
        type="text"
        placeholder="Add a sticky note…"
        class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        @keydown.enter.prevent="addNote"
      />
      <button
        type="button"
        :disabled="saving || !newNote.trim()"
        class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        @click="addNote"
      >
        Add
      </button>
    </div>
  </div>
</template>
