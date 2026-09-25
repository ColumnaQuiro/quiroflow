<script setup lang="ts">
import { nextDate, startOfLocalDate } from '~/utils/clinicClock'

// Days the whole location is shut: a bank holiday, the August fortnight.
// Stored as availability blocks with no practitioner and no room, which is
// what the calendar already draws as "Bloqueado (toda la clínica)", and what
// online booking and the public API already treat as closed for everyone --
// so this is a way to add them in days, from where the hours are, rather
// than a second kind of closure.
const props = defineProps<{ clinicId: string; timezone: string }>()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface Closure {
  id: string
  starts_at: string
  ends_at: string
  note: string | null
}
const closures = ref<Closure[]>([])
async function load() {
  const { data } = await supabase
    .from('availability_blocks')
    .select('id, starts_at, ends_at, note')
    .eq('clinic_id', props.clinicId)
    .is('practitioner_id', null)
    .is('room_id', null)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at')
  closures.value = data ?? []
}
onMounted(load)

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { timeZone: props.timezone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
function range(c: Closure) {
  // ends_at is the midnight after the last day, so the last day is a moment before it.
  const last = new Date(new Date(c.ends_at).getTime() - 1).toISOString()
  const a = fmt(c.starts_at)
  const b = fmt(last)
  return a === b ? a : `${a} – ${b}`
}

const adding = ref(false)
const from = ref('')
const to = ref('')
const note = ref('')
const saving = ref(false)
const bookedInside = ref(0)
const toBeforeFrom = computed(() => !!from.value && !!to.value && to.value < from.value)

// Appointments already booked in the chosen days: a closure hides the slots
// but moves nobody, so say so before it is saved.
watch([from, to], async () => {
  bookedInside.value = 0
  if (!from.value || toBeforeFrom.value) return
  const start = startOfLocalDate(from.value, props.timezone)
  const end = startOfLocalDate(nextDate(to.value || from.value), props.timezone)
  const { count } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', props.clinicId)
    .is('deleted_at', null)
    .not('status', 'in', '(cancelled,no_show)')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
  bookedInside.value = count ?? 0
})

async function add() {
  if (!from.value || toBeforeFrom.value || !store.accountId) return
  saving.value = true
  const { error } = await supabase.from('availability_blocks').insert({
    account_id: store.accountId,
    clinic_id: props.clinicId,
    starts_at: startOfLocalDate(from.value, props.timezone).toISOString(),
    ends_at: startOfLocalDate(nextDate(to.value || from.value), props.timezone).toISOString(),
    note: note.value.trim() || null,
    created_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  adding.value = false
  from.value = ''
  to.value = ''
  note.value = ''
  await load()
}

async function remove(c: Closure) {
  const { error } = await supabase.from('availability_blocks').delete().eq('id', c.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  await load()
}
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="clinic-closures">
    <p v-if="closures.length === 0" class="text-[13.5px] text-ink-muted">{{ t('No closures coming up.', 'No hay cierres próximos.') }}</p>
    <div v-for="c in closures" :key="c.id" class="flex items-center gap-3 rounded-ctl border border-line px-3.5 py-2.5" data-cy="clinic-closure">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="text-[14px] font-semibold text-ink-900">{{ range(c) }}</span>
        <span v-if="c.note" class="text-[13px] text-ink-500">{{ c.note }}</span>
      </div>
      <button type="button" data-cy="clinic-closure-remove" class="h-11 rounded-ctl px-3 text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle hover:text-ink-700" @click="remove(c)">
        {{ t('Remove', 'Quitar') }}
      </button>
    </div>
    <div v-if="adding" class="flex flex-col gap-3 rounded-card border border-line bg-surface-subtle p-3.5">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('From', 'Desde') }}
          <input v-model="from" type="date" data-cy="closure-from" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('To (included)', 'Hasta (incluido)') }}
          <input v-model="to" type="date" data-cy="closure-to" :min="from || undefined" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
        </label>
      </div>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Reason (optional)', 'Motivo (opcional)') }}
        <input v-model="note" type="text" data-cy="closure-note" :placeholder="t('Bank holiday, holidays…', 'Festivo local, vacaciones…')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <p v-if="toBeforeFrom" class="text-[12.5px] font-semibold text-danger-text">{{ t('The last day is before the first.', 'El último día es anterior al primero.') }}</p>
      <p v-else-if="bookedInside > 0" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning-text" data-cy="closure-booked">
        {{ t(`${bookedInside} appointments are already booked in these days. Closing hides the free slots but moves nobody.`, `Ya hay ${bookedInside} citas en esos días. Cerrar oculta los huecos libres, pero no mueve a nadie.`) }}
      </p>
      <div class="flex gap-2">
        <button type="button" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700" @click="adding = false">{{ t('Cancel', 'Cancelar') }}</button>
        <button type="button" data-cy="closure-save" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-60" :disabled="saving || !from || toBeforeFrom" @click="add">{{ t('Add closure', 'Añadir cierre') }}</button>
      </div>
    </div>
    <div v-else>
      <button type="button" data-cy="closure-add" class="h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="adding = true">
        {{ t('Add a holiday or closure…', 'Añadir un día festivo o cierre…') }}
      </button>
    </div>
  </div>
</template>
