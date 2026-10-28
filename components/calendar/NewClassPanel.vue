<script setup lang="ts">
// "Nueva clase" on the Calendar: puts a class -- an appointment type with
// places (Settings > Appointment types > Group class) -- on the calendar,
// once or every week for a number of weeks. Each date is a class_sessions
// row; patients then take places in it from the class's own panel or from
// online booking. Times are read in this browser's zone, as the Calendar's.
const props = defineProps<{ date?: string | null }>()
const emit = defineEmits<{ close: []; created: [] }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

interface ClassType { id: string; name: string; duration_minutes: number; class_capacity: number }
interface Member { id: string; full_name: string }
interface Room { id: string; name: string }

const today = new Date()
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const types = ref<ClassType[]>([])
const practitioners = ref<Member[]>([])
const rooms = ref<Room[]>([])
const typeId = ref('')
const practitionerId = ref('')
const roomId = ref('')
const date = ref(props.date ?? iso(today))
const time = ref('19:00')
const weeks = ref(1)
const capacity = ref<number | ''>('')
const busy = ref(false)
const error = ref('')
const loaded = ref(false)

onMounted(async () => {
  const [{ data: ts }, { data: team }, { data: res }] = await Promise.all([
    supabase.from('appointment_types').select('id, name, duration_minutes, class_capacity').not('class_capacity', 'is', null).is('archived_at', null).order('name'),
    supabase.from('team_members').select('id, full_name').eq('is_practitioner', true).is('deleted_at', null).order('full_name'),
    supabase.from('calendar_resources').select('id, name').eq('clinic_id', store.currentClinicId!).order('name'),
  ])
  types.value = (ts as ClassType[] | null) ?? []
  practitioners.value = (team as Member[] | null) ?? []
  rooms.value = (res as Room[] | null) ?? []
  typeId.value = types.value[0]?.id ?? ''
  practitionerId.value = practitioners.value.find((p) => p.id === store.teamMember?.id)?.id ?? practitioners.value[0]?.id ?? ''
  loaded.value = true
})
const type = computed(() => types.value.find((x) => x.id === typeId.value) ?? null)
watch(type, (x) => { capacity.value = x?.class_capacity ?? '' }, { immediate: true })

// Every date it will be on: the first, then a week apart.
const starts = computed(() => {
  if (!date.value || !time.value) return []
  const first = new Date(`${date.value}T${time.value}`)
  return Array.from({ length: Math.max(1, Math.min(52, Number(weeks.value) || 1)) }, (_, i) => {
    const d = new Date(first)
    d.setDate(d.getDate() + i * 7)
    return d
  })
})

async function create() {
  error.value = ''
  if (!type.value || !practitionerId.value || !starts.value.length || !capacity.value) {
    error.value = t('Choose the class, who gives it and when.', 'Elige la clase, quién la da y cuándo.')
    return
  }
  if (starts.value[0]!.getTime() < Date.now()) {
    error.value = t('That time has passed.', 'Esa hora ya ha pasado.')
    return
  }
  busy.value = true
  const minutes = type.value.duration_minutes
  const { error: e } = await supabase.from('class_sessions').insert(
    starts.value.map((s) => ({
      account_id: store.accountId!,
      clinic_id: store.currentClinicId!,
      appointment_type_id: type.value!.id,
      practitioner_id: practitionerId.value,
      room_id: roomId.value || null,
      starts_at: s.toISOString(),
      ends_at: new Date(s.getTime() + minutes * 60_000).toISOString(),
      capacity: Number(capacity.value),
      created_by: store.teamMember?.id ?? null,
    })),
  )
  busy.value = false
  if (e) {
    error.value = e.code === '23505' ? t('That class is already on at one of those times.', 'Esa clase ya está puesta a una de esas horas.') : e.message
    return
  }
  emit('created')
}

const field = 'mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 p-4" @click.self="emit('close')">
    <div class="max-h-full w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-popover" role="dialog" aria-modal="true" aria-labelledby="new-class-title" data-cy="new-class">
      <div class="flex items-center justify-between">
        <h2 id="new-class-title" class="text-[16px] font-[640] text-ink-900">{{ t('New class', 'Nueva clase') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="-m-2 p-2 text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>
      <p v-if="loaded && !types.length" class="mt-3 text-[13px] text-ink-muted" data-cy="new-class-no-types">
        {{ t('No appointment type is a class yet. Give one places in Settings › Appointment types.', 'Ningún tipo de cita es una clase todavía. Dale plazas en Ajustes › Tipos de cita.') }}
      </p>
      <template v-else>
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="text-[12.5px] font-medium text-ink-600 sm:col-span-2">{{ t('Class', 'Clase') }}
            <select v-model="typeId" :class="field" data-cy="new-class-type">
              <option v-for="x in types" :key="x.id" :value="x.id">{{ x.name }} · {{ x.duration_minutes }} min</option>
            </select>
          </label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('Given by', 'La da') }}
            <select v-model="practitionerId" :class="field" data-cy="new-class-practitioner">
              <option v-for="p in practitioners" :key="p.id" :value="p.id">{{ p.full_name }}</option>
            </select>
          </label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('Room', 'Sala') }}
            <select v-model="roomId" :class="field" data-cy="new-class-room">
              <option value="">{{ t('None', 'Ninguna') }}</option>
              <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('First day', 'Primer día') }}<input v-model="date" type="date" :class="field" data-cy="new-class-date" /></label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('Time', 'Hora') }}<input v-model="time" type="time" :class="field" data-cy="new-class-time" /></label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('Weeks (same day and time)', 'Semanas (mismo día y hora)') }}<input v-model.number="weeks" type="number" min="1" max="52" :class="field" data-cy="new-class-weeks" /></label>
          <label class="text-[12.5px] font-medium text-ink-600">{{ t('Places', 'Plazas') }}<input v-model.number="capacity" type="number" min="1" max="200" :class="field" data-cy="new-class-capacity" /></label>
        </div>
        <p v-if="starts.length > 1" class="mt-3 text-[12.5px] text-ink-muted">
          {{ t(`${starts.length} classes, every week until`, `${starts.length} clases, cada semana hasta el`) }}
          {{ starts[starts.length - 1]!.toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) }}.
        </p>
        <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <UiBtn @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn variant="primary" :disabled="busy" data-cy="new-class-create" @click="create">{{ t('Put it on the calendar', 'Ponerla en la agenda') }}</UiBtn>
        </div>
      </template>
    </div>
  </div>
</template>
