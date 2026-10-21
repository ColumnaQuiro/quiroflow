<script setup lang="ts">
import { formatTime, formatWeekdayDate } from '~/utils/billing'
import { appointmentsUnderBlock } from '~/utils/moveClash'

// The visits a block about to be saved would sit on top of ("Bloquear
// horario"). A block never moved or cancelled anything, and it still does
// not: the visits stay booked inside the grey. What was missing was being
// told, so the desk can call the patients or move them first. Shown live as
// the dates, times, practitioner and room change; `count` lets the form say
// "Block anyway" while there are any.
//
// Which visits a block reaches is utils/moveClash.ts's appointmentsUnderBlock,
// the same reach a block has everywhere else.

interface UnderBlockRow {
  id: string
  starts_at: string
  ends_at: string
  practitioner_id: string | null
  room_id: string | null
  clinic_id: string | null
  status: string | null
  deleted_at: string | null
  patients: { first_name: string; last_name: string | null } | null
  team_members: { full_name: string } | null
}

const props = defineProps<{
  startsAt: string | null
  endsAt: string | null
  practitionerId: string | null
  roomId: string | null
}>()
const count = defineModel<number>('count', { default: 0 })

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const visits = ref<UnderBlockRow[]>([])
const SHOWN = 6

let run = 0
async function check() {
  const mine = ++run
  if (!props.startsAt || !props.endsAt || props.endsAt <= props.startsAt) {
    visits.value = []
    count.value = 0
    return
  }
  let q = supabase
    .from('appointments')
    .select('id, starts_at, ends_at, practitioner_id, room_id, clinic_id, status, deleted_at, patients(first_name, last_name), team_members(full_name)')
    .eq('account_id', store.accountId!)
    .is('deleted_at', null)
    .not('status', 'in', '(cancelled,no_show)')
    .lt('starts_at', props.endsAt)
    .gt('ends_at', props.startsAt)
    .order('starts_at')
    .limit(200)
  q = props.practitionerId ? q.eq('practitioner_id', props.practitionerId) : q.eq('clinic_id', store.currentClinicId!)
  const { data } = await q
  if (mine !== run) return
  visits.value = appointmentsUnderBlock(
    { practitionerId: props.practitionerId, roomId: props.roomId, clinicId: store.currentClinicId, startsAt: props.startsAt, endsAt: props.endsAt },
    (data as unknown as UnderBlockRow[] | null) ?? [],
  )
  count.value = visits.value.length
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [props.startsAt, props.endsAt, props.practitionerId, props.roomId],
  () => {
    clearTimeout(timer)
    timer = setTimeout(check, 250)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearTimeout(timer))

const name = (v: UnderBlockRow) => `${v.patients?.first_name ?? ''} ${v.patients?.last_name ?? ''}`.trim() || t('Patient', 'Paciente')
</script>

<template>
  <div v-if="visits.length" role="status" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px]" data-cy="block-clashes">
    <p class="font-semibold text-warning-text">
      {{ visits.length === 1 ? t('There is already a visit booked in this time', 'Ya hay una cita reservada en este horario') : t(`There are already ${visits.length} visits booked in this time`, `Ya hay ${visits.length} citas reservadas en este horario`) }}
    </p>
    <ul class="mt-1.5 flex flex-col gap-0.5 text-ink-700">
      <li v-for="v in visits.slice(0, SHOWN)" :key="v.id" class="truncate" data-cy="block-clash">
        {{ formatWeekdayDate(v.starts_at) }} · <span class="font-mono">{{ formatTime(v.starts_at) }}</span> · {{ name(v) }}<template v-if="v.team_members && !practitionerId"> · {{ v.team_members.full_name }}</template>
      </li>
      <li v-if="visits.length > SHOWN" class="text-ink-muted">{{ t(`and ${visits.length - SHOWN} more`, `y ${visits.length - SHOWN} más`) }}</li>
    </ul>
    <p class="mt-1.5 text-ink-muted">
      {{ t('Blocking does not move or cancel them: they stay booked. If a practitioner is off, “Unplanned absence” moves or cancels their visits.', 'Bloquear no las mueve ni las cancela: siguen reservadas. Si un profesional falta, «Ausencia imprevista» mueve o cancela sus citas.') }}
    </p>
  </div>
</template>
