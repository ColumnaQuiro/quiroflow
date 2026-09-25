<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { CALENDAR_PALETTE } from '~/utils/calendarPalette'
import { DURATION_MAX, DURATION_MIN, TYPE_STAGES, moveItem, nameKey, orderTypes, parseEurosToCents, parseMinutes, typeProblems } from '~/utils/appointmentTypes'

// Settings -> Appointment Types: what can be booked, in the order the
// calendar and online booking offer it, each opening onto its own page
// (/settings/appointment-types/<id>) where everything about it is edited with
// one Guardar. Archived types sit apart at the bottom.
//
// This used to be one wide table that saved every cell on blur and ignored
// the result -- a refused save looked exactly like a good one -- and whose ✕
// deleted a type from every appointment that had ever used it.

const supabase = useSupabaseClient()
const store = useAccountStore()
const router = useRouter()
const t = useT()
const { showToast } = useToast()

interface TypeRow {
  id: string
  name: string
  duration_minutes: number
  default_price_cents: number
  color: string
  stage: string | null
  online_booking_enabled: boolean
  online_bookable_by: string
  online_payment_required: boolean
  online_deposit_cents: number | null
  sort_order: number | null
  archived_at: string | null
}
interface Usage { id: string; appointments: number; upcoming: number; waitlist: number }

const types = ref<TypeRow[]>([])
const usage = ref<Record<string, Usage>>({})
const overrideCounts = ref<Record<string, number>>({})
const ready = ref(false)
const query = ref('')

const active = computed(() => orderTypes(types.value.filter((x) => !x.archived_at)))
const archived = computed(() => types.value.filter((x) => x.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'es')))
const shown = computed(() => {
  const q = nameKey(query.value)
  return q ? active.value.filter((x) => nameKey(x.name).includes(q)) : active.value
})
// Reordering a filtered list would move a type relative to ones you cannot
// see, so the handles only work on the whole list.
const canReorder = computed(() => !query.value.trim() && active.value.length > 1)

async function load() {
  const [{ data, error }, { data: use }, { data: ovr }] = await Promise.all([
    supabase
      .from('appointment_types')
      .select('id, name, duration_minutes, default_price_cents, color, stage, online_booking_enabled, online_bookable_by, online_payment_required, online_deposit_cents, sort_order, archived_at'),
    supabase.rpc('get_appointment_type_usage', { p_account_id: store.accountId! }),
    supabase.from('appointment_type_overrides').select('appointment_type_id, team_members(is_practitioner, deleted_at)'),
  ])
  if (error) {
    showToast(error.message, 'error')
    return
  }
  types.value = (data ?? []) as TypeRow[]
  usage.value = Object.fromEntries(((use as Usage[] | null) ?? []).map((u) => [u.id, u]))
  // Only overrides of practitioners still working count: the type page lists
  // no one else, so counting a departed practitioner's row here would promise
  // a price nobody can see or change.
  const counts: Record<string, number> = {}
  for (const o of (ovr ?? []) as { appointment_type_id: string; team_members: { is_practitioner: boolean; deleted_at: string | null } | null }[]) {
    if (o.team_members?.is_practitioner && !o.team_members.deleted_at) counts[o.appointment_type_id] = (counts[o.appointment_type_id] ?? 0) + 1
  }
  overrideCounts.value = counts
}

onMounted(async () => {
  if (!store.accountId) await store.load()
  await load()
  ready.value = true
})

function stageLabel(stage: string | null) {
  const s = TYPE_STAGES.find((x) => x.value === stage)
  return s ? t(s.en, s.es) : null
}

function chips(x: TypeRow) {
  const out: { text: string; tone: 'neutral' | 'ok' | 'warn' | 'info' }[] = []
  const stage = stageLabel(x.stage)
  out.push(stage ? { text: stage, tone: 'neutral' } : { text: t('No stage: not counted in Statistics', 'Sin etapa: no cuenta en Estadísticas'), tone: 'warn' })
  if (x.online_booking_enabled) {
    out.push({ text: t('Online booking', 'Reserva online'), tone: 'ok' })
    if (x.online_bookable_by === 'new_patients') out.push({ text: t('New patients only', 'Solo pacientes nuevos'), tone: 'neutral' })
    if (x.online_bookable_by === 'existing_patients') out.push({ text: t('Existing patients only', 'Solo pacientes actuales'), tone: 'neutral' })
    if (x.online_payment_required) {
      out.push({
        text: x.online_deposit_cents != null ? t(`Paid when booking · deposit ${formatEur(x.online_deposit_cents)}`, `Pago al reservar · señal ${formatEur(x.online_deposit_cents)}`) : t('Paid when booking', 'Pago al reservar'),
        tone: 'info',
      })
    }
  } else {
    out.push({ text: t('Not booked online', 'No se reserva online'), tone: 'neutral' })
  }
  const n = overrideCounts.value[x.id] ?? 0
  if (n > 0) out.push({ text: n === 1 ? t('1 practitioner with own price', '1 profesional con precio propio') : t(`${n} practitioners with own price`, `${n} profesionales con precio propio`), tone: 'neutral' })
  return out
}
const TONES = {
  neutral: 'bg-chip-bg text-chip-text',
  ok: 'bg-success-bg text-success-text',
  warn: 'bg-warning-bg text-warning-text',
  info: 'bg-info-bg text-info-text',
}

function appointmentsLabel(id: string) {
  const n = usage.value[id]?.appointments ?? 0
  return n === 1 ? t('1 appointment', '1 cita') : t(`${n.toLocaleString('es-ES')} appointments`, `${n.toLocaleString('es-ES')} citas`)
}
function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

// --- Order -------------------------------------------------------------------------
// Saved as soon as it changes, as one statement (reorder_appointment_types),
// and put back if the database refuses it.
const reordering = ref(false)
async function applyOrder(next: TypeRow[]) {
  const before = types.value.map((x) => ({ ...x }))
  next.forEach((x, i) => {
    const row = types.value.find((r) => r.id === x.id)
    if (row) row.sort_order = i + 1
  })
  reordering.value = true
  const { error } = await supabase.rpc('reorder_appointment_types', { p_ids: next.map((x) => x.id) })
  reordering.value = false
  if (error) {
    types.value = before
    showToast(t(`The new order was not saved: ${error.message}`, `No se ha guardado el nuevo orden: ${error.message}`), 'error', 8000)
  }
}
function move(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= active.value.length || reordering.value) return
  applyOrder(moveItem(active.value, index, to))
}

const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)
function onDragStart(index: number, e: DragEvent) {
  if (!canReorder.value) return
  dragIndex.value = index
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(index: number, e: DragEvent) {
  if (dragIndex.value === null) return
  e.preventDefault()
  overIndex.value = index
}
function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  overIndex.value = null
  if (from === null || from === index) return
  applyOrder(moveItem(active.value, from, index))
}
function onDragEnd() {
  dragIndex.value = null
  overIndex.value = null
}

// --- New type ----------------------------------------------------------------------
const addOpen = ref(false)
const newName = ref('')
// string | number: a number input's v-model hands back a number once typed.
const newDuration = ref<string | number>('30')
const newPrice = ref('')
const newOnline = ref(false)
const adding = ref(false)
const addTried = ref(false)
const addError = ref('')

function openAdd() {
  newName.value = ''
  newDuration.value = '30'
  newPrice.value = ''
  newOnline.value = false
  addTried.value = false
  addError.value = ''
  addOpen.value = true
}

const addProblems = computed(() =>
  typeProblems({ name: newName.value, duration: newDuration.value, price: newPrice.value, paymentRequired: false, deposit: '', maxDaysAhead: '' }, active.value),
)

async function addType() {
  addTried.value = true
  addError.value = ''
  if (adding.value || Object.keys(addProblems.value).length > 0) return
  adding.value = true
  const { data, error } = await supabase
    .from('appointment_types')
    .insert({
      account_id: store.accountId!,
      name: newName.value.trim(),
      duration_minutes: parseMinutes(newDuration.value)!,
      default_price_cents: parseEurosToCents(newPrice.value) ?? 0,
      // Explicit, though it is also the column's default now: a type made to
      // try something out must not appear on the public booking page.
      online_booking_enabled: newOnline.value,
      color: CALENDAR_PALETTE[types.value.length % CALENDAR_PALETTE.length]!.hex,
    })
    .select('id')
    .single()
  adding.value = false
  if (error) {
    addError.value = error.code === '23505' ? t('There is already a type with that name.', 'Ya hay un tipo con ese nombre.') : error.message
    return
  }
  addOpen.value = false
  router.push(`/settings/appointment-types/${data!.id}`)
}

// --- Reactivate --------------------------------------------------------------------
const reactivating = ref<string | null>(null)
async function reactivate(x: TypeRow) {
  reactivating.value = x.id
  const { error } = await supabase.from('appointment_types').update({ archived_at: null }).eq('id', x.id).select('id').single()
  reactivating.value = null
  if (error) {
    showToast(
      error.code === '23505'
        ? t(`There is already an active type called ${x.name}. Rename one of the two first.`, `Ya hay un tipo activo llamado ${x.name}. Cambia antes el nombre de uno de los dos.`)
        : error.message,
      'error',
      8000,
    )
    return
  }
  showToast(t(`${x.name} is offered again.`, `${x.name} vuelve a ofrecerse.`))
  await load()
}

const inputClass = 'h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Appointment Types', 'Tipos de cita')">
      <button type="button" data-cy="type-add" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover" @click="openAdd">
        {{ t('New type', 'Nuevo tipo') }}
      </button>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="types-page" :data-ready="ready ? 'true' : undefined">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What gets booked: duration, price, colour and how it is booked online.', 'Lo que se reserva: duración, precio, color y cómo se reserva online.') }}
          </p>

          <section aria-labelledby="h-types" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex flex-wrap items-center gap-2 px-[18px] pb-3 pt-4">
              <h2 id="h-types" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Appointment types · ${active.length}`, `Tipos de cita · ${active.length}`) }}</h2>
              <label class="flex h-11 w-full items-center gap-2 rounded-ctl border border-line-control px-3 text-ink-muted sm:w-[260px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input
                  v-model="query"
                  data-cy="types-search"
                  :placeholder="t('Search type', 'Buscar tipo')"
                  :aria-label="t('Search appointment type', 'Buscar tipo de cita')"
                  class="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-900 outline-none"
                />
              </label>
            </div>

            <template v-if="!ready">
              <div v-for="i in 3" :key="i" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-4 w-4 rounded-full" />
                <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="active.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No appointment types yet. Create the first one to start booking.', 'Todavía no hay tipos de cita. Crea el primero para empezar a reservar.') }}
            </p>
            <p v-else-if="shown.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No type matches.', 'Ningún tipo coincide.') }}
            </p>

            <ol v-if="ready" :aria-label="t('Appointment types, in order', 'Tipos de cita, en orden')">
              <li
                v-for="(x, i) in shown"
                :key="x.id"
                data-cy="type-row"
                :data-type-id="x.id"
                class="flex items-center gap-2 border-t border-line-row pr-3"
                :class="[overIndex === i && dragIndex !== i ? 'bg-brand-tint' : '', dragIndex === i ? 'opacity-50' : '']"
                :draggable="canReorder"
                @dragstart="onDragStart(i, $event)"
                @dragover="onDragOver(i, $event)"
                @drop.prevent="onDrop(i)"
                @dragend="onDragEnd"
              >
                <span
                  v-if="canReorder"
                  class="flex h-11 w-7 shrink-0 cursor-grab items-center justify-center text-ink-faint"
                  :title="t('Drag to reorder', 'Arrastra para cambiar el orden')"
                  aria-hidden="true"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                </span>
                <span v-else class="w-3 shrink-0" />
                <NuxtLink :to="`/settings/appointment-types/${x.id}`" data-cy="type-link" class="flex min-h-[72px] min-w-0 flex-1 items-center gap-3.5 py-3" draggable="false">
                  <span class="h-4 w-4 shrink-0 rounded-full" :style="{ background: x.color }" aria-hidden="true" />
                  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div class="flex flex-wrap items-baseline gap-x-2.5">
                      <strong class="text-[15.5px] text-ink-900" data-cy="type-name">{{ x.name }}</strong>
                      <span class="text-[13.5px] text-ink-500">{{ x.duration_minutes }} min · {{ formatEur(x.default_price_cents) }}</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <span v-for="c in chips(x)" :key="c.text" class="inline-flex h-6 items-center whitespace-nowrap rounded-pill px-2.5 text-[12px] font-bold" :class="TONES[c.tone]">{{ c.text }}</span>
                    </div>
                  </div>
                  <span class="hidden whitespace-nowrap text-[13px] text-ink-muted sm:inline" data-cy="type-uses">{{ appointmentsLabel(x.id) }}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </NuxtLink>
                <div v-if="canReorder" class="flex shrink-0 flex-col">
                  <button
                    type="button"
                    data-cy="type-move-up"
                    :disabled="i === 0 || reordering"
                    :aria-label="t(`Move ${x.name} up`, `Subir ${x.name}`)"
                    class="flex h-11 w-11 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle disabled:opacity-30"
                    @click="move(i, -1)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    data-cy="type-move-down"
                    :disabled="i === shown.length - 1 || reordering"
                    :aria-label="t(`Move ${x.name} down`, `Bajar ${x.name}`)"
                    class="flex h-11 w-11 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle disabled:opacity-30"
                    @click="move(i, 1)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
              </li>
            </ol>

            <details v-if="archived.length > 0" class="border-t border-line" data-cy="types-archived" open>
              <summary class="flex min-h-[52px] cursor-pointer items-center px-[18px] text-[14px] font-semibold text-ink-700">
                {{ t(`Archived · ${archived.length}`, `Archivados · ${archived.length}`) }}
              </summary>
              <div v-for="x in archived" :key="x.id" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-3" data-cy="type-archived-row" :data-type-id="x.id">
                <span class="h-4 w-4 shrink-0 rounded-full bg-chip-bg" aria-hidden="true" />
                <NuxtLink :to="`/settings/appointment-types/${x.id}`" class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="text-[15px] text-ink-700">{{ x.name }}</strong>
                  <span class="text-[13px] text-ink-muted">
                    {{ t(`Archived ${formatDay(x.archived_at!)} · still on its ${usage[x.id]?.appointments ?? 0} appointments and in reports`, `Archivado el ${formatDay(x.archived_at!)} · sigue en sus ${usage[x.id]?.appointments ?? 0} citas y en los informes`) }}
                  </span>
                </NuxtLink>
                <button
                  type="button"
                  data-cy="type-reactivate"
                  :disabled="reactivating === x.id"
                  class="h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-60"
                  @click="reactivate(x)"
                >
                  {{ t('Reactivate', 'Reactivar') }}
                </button>
              </div>
            </details>
          </section>

          <p class="flex gap-2.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('This order is the one the calendar and online booking show. Drag to change it, or use the arrows. The first one is proposed when creating an appointment.', 'El orden de la lista es el que se ve en el calendario y en la reserva online. Arrastra para cambiarlo, o usa las flechas. El primero es el que se propone al crear una cita.') }}
          </p>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="addOpen"
      :title="t('New appointment type', 'Nuevo tipo de cita')"
      :confirm-label="adding ? t('Creating…', 'Creando…') : t('Create and complete', 'Crear y completar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="adding"
      @confirm="addType"
      @cancel="addOpen = false"
    >
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Name', 'Nombre') }}
        <input
          v-model="newName"
          data-cy="type-new-name"
          type="text"
          :placeholder="t('E.g. Follow-up adjustment', 'Ej. Ajuste de seguimiento')"
          :class="[inputClass, addTried && addProblems.name ? 'border-danger-text' : 'border-line-control']"
          @keydown.enter.prevent="addType"
        />
        <span v-if="addTried && addProblems.name === 'name_missing'" class="text-[12.5px] font-semibold text-danger-text">{{ t('A type needs a name.', 'El tipo necesita un nombre.') }}</span>
        <span v-else-if="addTried && addProblems.name === 'name_taken'" class="text-[12.5px] font-semibold text-danger-text" data-cy="type-new-name-taken">{{ t('There is already a type with that name.', 'Ya hay un tipo con ese nombre.') }}</span>
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Duration (min)', 'Duración (min)') }}
          <input v-model="newDuration" data-cy="type-new-duration" type="number" :min="DURATION_MIN" :max="DURATION_MAX" step="5" inputmode="numeric" :class="[inputClass, addTried && addProblems.duration ? 'border-danger-text' : 'border-line-control']" />
          <span v-if="addTried && addProblems.duration" class="text-[12.5px] font-semibold text-danger-text">{{ t(`Between ${DURATION_MIN} and ${DURATION_MAX}.`, `Entre ${DURATION_MIN} y ${DURATION_MAX}.`) }}</span>
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Price (€)', 'Precio (€)') }}
          <input v-model="newPrice" data-cy="type-new-price" type="text" inputmode="decimal" placeholder="40,00" :class="[inputClass, addTried && addProblems.price ? 'border-danger-text' : 'border-line-control']" />
          <span v-if="addTried && addProblems.price" class="text-[12.5px] font-semibold text-danger-text">{{ t('Not an amount.', 'No es un importe.') }}</span>
        </label>
      </div>
      <SettingsSwitchRow
        v-model="newOnline"
        data-cy="type-new-online"
        :title="t('Bookable online from now', 'Reservable online desde ya')"
        :description="t('If you leave it off, you turn it on when it is ready.', 'Si lo dejas apagado, lo activas cuando esté listo.')"
      />
      <p v-if="addError" class="text-[13px] font-semibold text-danger-text" data-cy="type-new-error">{{ addError }}</p>
    </UiConfirmDialog>
  </div>
</template>
