<script setup lang="ts">
interface RoomRow {
  id: string
  name: string
  clinic_id: string
  clinics: { name: string } | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const rooms = ref<RoomRow[]>([])
const loading = ref(true)

const name = ref('')
const clinicId = ref(store.currentClinicId ?? '')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('calendar_resources')
    .select('id, name, clinic_id, clinics(name)')
    .order('name')
  rooms.value = (data as unknown as RoomRow[]) ?? []
  loading.value = false
}
onMounted(load)

async function addRoom() {
  error.value = ''
  if (!name.value.trim() || !clinicId.value) return
  saving.value = true
  const { error: insertError } = await supabase.from('calendar_resources').insert({
    account_id: store.accountId!,
    clinic_id: clinicId.value,
    name: name.value.trim(),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function removeRoom(id: string) {
  if (!confirm(t('Delete this room?', '¿Eliminar esta sala?'))) return
  await supabase.from('calendar_resources').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Calendar Resources', 'Recursos del Calendario')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('Rooms used for scheduling per clinic.', 'Salas usadas para la programación por clínica.') }}</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Room', 'Sala') }}</th>
                  <th class="px-4 py-2">{{ t('Clinic', 'Clínica') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <template v-if="loading">
                  <tr v-for="i in 4" :key="i">
                    <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-24 rounded-ctlSm" /></td>
                    <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-28 rounded-ctlSm" /></td>
                    <td class="px-4 py-2.5" />
                  </tr>
                </template>
                <tr v-else-if="rooms.length === 0">
                  <td colspan="3" class="px-4 py-6 text-center text-ink-faint">{{ t('No rooms yet.', 'Aún no hay salas.') }}</td>
                </tr>
                <tr v-for="r in rooms" :key="r.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ r.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ r.clinics?.name }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeRoom(r.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addRoom">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Room name', 'Nombre de la sala') }}</label>
              <input v-model="name" type="text" required placeholder="Sala 2" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Clinic', 'Clínica') }}</label>
              <select v-model="clinicId" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Room', 'Añadir Sala') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
