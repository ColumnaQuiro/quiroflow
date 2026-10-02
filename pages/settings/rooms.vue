<script setup lang="ts">
// Rooms, grouped under the clinic they belong to rather than a table with a
// Clinic column -- a room only ever exists inside one clinic, and a clinic
// with none is worth saying out loud (its appointments are booked without a
// room), which a flat table cannot show.

interface RoomRow {
  id: string
  name: string
  clinic_id: string
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const rooms = ref<RoomRow[]>([])
const weekCounts = ref<Record<string, number>>({})
const loading = ref(true)

// Monday 00:00 to the next Monday, local time: "this week" as the calendar shows it.
function weekBounds() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function load() {
  const { data } = await supabase.from('calendar_resources').select('id, name, clinic_id').order('name')
  rooms.value = data ?? []
  loading.value = false
  // A head count per room rather than one select of the week's appointments,
  // which a busy week could push past PostgREST's row cap.
  const { start, end } = weekBounds()
  const counts = await Promise.all(
    rooms.value.map((r) =>
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', r.id)
        .is('deleted_at', null)
        .neq('status', 'cancelled')
        .gte('starts_at', start)
        .lt('starts_at', end),
    ),
  )
  weekCounts.value = Object.fromEntries(rooms.value.map((r, i) => [r.id, counts[i].count ?? 0]))
}
onMounted(load)

const groups = computed(() => store.clinics.map((c) => ({ clinic: c, rooms: rooms.value.filter((r) => r.clinic_id === c.id) })))

function weekLabel(id: string) {
  const n = weekCounts.value[id]
  if (n === undefined) return ''
  if (n === 0) return t('Nothing booked this week', 'Nada reservado esta semana')
  return n === 1 ? t('1 appointment this week', '1 cita esta semana') : t(`${n} appointments this week`, `${n} citas esta semana`)
}

function roomsHeading(name: string, n: number) {
  if (n === 0) return t(`${name} · no rooms`, `${name} · sin salas`)
  return n === 1 ? t(`${name} · 1 room`, `${name} · 1 sala`) : t(`${name} · ${n} rooms`, `${name} · ${n} salas`)
}

// --- adding, inline under the clinic it is for ---

const addingFor = ref<string | null>(null)
const newName = ref('')
const saving = ref(false)
const addError = ref('')

function startAdd(clinicId: string) {
  addingFor.value = clinicId
  newName.value = ''
  addError.value = ''
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy="room-new-name"]')?.focus())
}

// The header's "New room" adds to the clinic being worked in.
function startAddCurrent() {
  const id = store.currentClinicId ?? store.clinics[0]?.id
  if (id) startAdd(id)
}

async function addRoom() {
  addError.value = ''
  const name = newName.value.trim()
  if (!name || !addingFor.value) return
  saving.value = true
  const { error } = await supabase.from('calendar_resources').insert({ account_id: store.accountId!, clinic_id: addingFor.value, name })
  saving.value = false
  if (error) {
    addError.value = error.message
    return
  }
  addingFor.value = null
  await load()
}

// --- renaming in place ---

const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(r: RoomRow) {
  renamingId.value = r.id
  renameValue.value = r.name
  nextTick(() => document.querySelector<HTMLInputElement>('[data-cy="room-rename"]')?.focus())
}

async function saveRename(r: RoomRow) {
  const name = renameValue.value.trim()
  if (!name || name === r.name) {
    renamingId.value = null
    return
  }
  const { error } = await supabase.from('calendar_resources').update({ name }).eq('id', r.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  r.name = name
  renamingId.value = null
}

// --- deleting, with what it does to the calendar said first ---

const deleting = ref<RoomRow | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  const { error } = await supabase.from('calendar_resources').delete().eq('id', deleting.value.id)
  deletingBusy.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Calendar Resources', 'Recursos del Calendario')">
      <UiBtn variant="primary" data-cy="room-add" @click="startAddCurrent">{{ t('New room', 'Nueva sala') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('The rooms appointments are booked into, grouped by clinic. A clinic with no rooms books without one.', 'Las salas en las que se reservan las citas, agrupadas por clínica. Una clínica sin salas reserva sin sala.') }}
          </p>

          <template v-if="loading">
            <section v-for="i in 2" :key="i" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4"><UiSkeleton class="h-4 w-48 rounded-ctlSm" /></div>
              <div v-for="j in 2" :key="j" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-9 w-9 rounded-ctl" />
                <UiSkeleton class="h-4 w-32 rounded-ctlSm" />
              </div>
            </section>
          </template>

          <section
            v-for="g in groups"
            v-else
            :key="g.clinic.id"
            :aria-labelledby="`h-clinic-${g.clinic.id}`"
            data-cy="room-clinic"
            class="overflow-hidden rounded-card border border-line bg-surface"
          >
            <div class="flex items-center gap-3 px-[18px] pb-3 pt-4">
              <h2 :id="`h-clinic-${g.clinic.id}`" class="flex-1 text-[16px] font-bold text-ink-900">{{ roomsHeading(g.clinic.name, g.rooms.length) }}</h2>
              <UiBtn @click="startAdd(g.clinic.id)">{{ t('Add room', 'Añadir sala') }}</UiBtn>
            </div>

            <div v-for="r in g.rooms" :key="r.id" data-cy="room-row" class="flex min-h-[64px] items-center gap-3.5 border-t border-line-row py-2.5 pl-[18px] pr-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3 21h18M14.5 12.5h.01" /></svg>
              </span>
              <form v-if="renamingId === r.id" class="flex min-w-0 flex-1 items-center gap-2" @submit.prevent="saveRename(r)">
                <input v-model="renameValue" data-cy="room-rename" type="text" :aria-label="t('Room name', 'Nombre de la sala')" :class="inputClass" @keydown.esc="renamingId = null" />
                <UiBtn variant="ghost" @click="renamingId = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <UiBtn variant="primary" type="submit">{{ t('Save', 'Guardar') }}</UiBtn>
              </form>
              <template v-else>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="text-[15px] text-ink-900" data-cy="room-name">{{ r.name }}</strong>
                  <span class="text-[13px] text-ink-muted">{{ weekLabel(r.id) }}</span>
                </div>
                <button type="button" :class="iconBtn" :aria-label="t(`Rename ${r.name}`, `Renombrar ${r.name}`)" @click="startRename(r)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
                <button type="button" data-cy="room-delete" :class="iconBtn" :aria-label="t(`Delete ${r.name}`, `Eliminar ${r.name}`)" @click="deleting = r">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </template>
            </div>

            <p v-if="g.rooms.length === 0 && addingFor !== g.clinic.id" class="border-t border-line-row px-[18px] py-4 text-[14px] text-ink-muted">
              {{ t('No rooms yet. Appointments at this clinic are booked without a room.', 'Aún no hay salas. Las citas de esta clínica se reservan sin sala.') }}
            </p>

            <form v-if="addingFor === g.clinic.id" class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle py-3 pl-[18px] pr-3" @submit.prevent="addRoom">
              <span class="h-9 w-9 shrink-0 rounded-ctl border-[1.5px] border-dashed border-line-controlHover" aria-hidden="true" />
              <input v-model="newName" data-cy="room-new-name" type="text" required :placeholder="t('E.g. Sala 2', 'Ej. Sala 2')" :aria-label="t('New room name', 'Nombre de la nueva sala')" :class="inputClass" @keydown.esc="addingFor = null" />
              <UiBtn variant="ghost" @click="addingFor = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
              <UiBtn variant="primary" type="submit" data-cy="room-new-save" :disabled="saving || !newName.trim()">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add room', 'Añadir sala') }}</UiBtn>
              <p v-if="addError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ addError }}</p>
            </form>
          </section>

          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('Deleting a room keeps its past appointments; they simply show no room. Time blocked on that room is removed with it.', 'Al eliminar una sala se conservan sus citas pasadas, que simplemente quedan sin sala. El tiempo bloqueado en esa sala se elimina con ella.') }}
          </p>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete ${deleting.name}?`, `¿Eliminar ${deleting.name}?`)"
      :confirm-label="deletingBusy ? t('Deleting…', 'Eliminando…') : t('Delete room', 'Eliminar sala')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deletingBusy"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Its appointments stay on the calendar without a room, and any time blocked on this room is removed.', 'Sus citas siguen en el calendario sin sala, y se elimina el tiempo bloqueado en esta sala.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
