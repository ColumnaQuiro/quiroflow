<script setup lang="ts">
import type { BusinessHours } from '../../utils/businessHours'
import { clinicDateOf } from '../../utils/clinicClock'
import { workdayWeekStart } from '../../utils/workday'
import { ABSENCE_KINDS, DEFAULT_LEAVE_DAYS, absenceKindLabel, formatShift, isOpenEndedAbsence, leaveWorkingDays, shiftForDay, type ShiftRanges } from '../../utils/staffShifts'

// "Mi jornada", the shifts and leave part (web /jornada and the app): this
// week's shifts, holiday days left this year, my requests, and asking for
// one. Design: TurnosPhone on the QuiroFlow canvas. Shared by the web and
// the app, so no account store: the caller says who and where.
const props = defineProps<{ accountId: string; teamMemberId: string; timeZone: string }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()

interface Absence { id: string; kind: string; starts_on: string; ends_on: string; half_day: boolean; status: string; note: string | null }
const member = ref<{ business_hours: BusinessHours | null; is_practitioner: boolean } | null>(null)
const clinicHours = ref<BusinessHours | null>(null)
const overrides = ref<Map<string, ShiftRanges>>(new Map())
const allowance = ref(DEFAULT_LEAVE_DAYS)
const absences = ref<Absence[]>([])
const closed = ref<Set<string>>(new Set())

const today = computed(() => clinicDateOf(new Date(), props.timeZone))
const year = computed(() => today.value.slice(0, 4))
const week = computed(() => {
  const start = workdayWeekStart(today.value)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${start}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })
})

async function load() {
  const [{ data: m }, { data: clinic }, { data: days }, { data: allow }, { data: abs }, { data: blocks }] = await Promise.all([
    supabase.from('team_members').select('business_hours, is_practitioner').eq('id', props.teamMemberId).maybeSingle(),
    supabase.from('clinics').select('business_hours').is('archived_at', null).order('created_at').limit(1).maybeSingle(),
    supabase.from('shift_days').select('day, ranges').eq('team_member_id', props.teamMemberId).gte('day', week.value[0]!).lte('day', week.value[6]!),
    supabase.from('staff_leave_allowances').select('days_per_year').eq('team_member_id', props.teamMemberId).maybeSingle(),
    supabase.from('staff_absences').select('id, kind, starts_on, ends_on, half_day, status, note').eq('team_member_id', props.teamMemberId).neq('status', 'cancelled').gte('ends_on', `${year.value}-01-01`).order('starts_on', { ascending: false }),
    // Whole-clinic closures this year: they are not holiday days.
    supabase.from('availability_blocks').select('starts_at, ends_at').is('practitioner_id', null).is('room_id', null).gte('ends_at', `${year.value}-01-01`).lte('starts_at', `${year.value}-12-31T23:59:59`),
  ])
  member.value = (m as { business_hours: BusinessHours | null; is_practitioner: boolean } | null) ?? null
  clinicHours.value = ((clinic as { business_hours: BusinessHours | null } | null)?.business_hours ?? null)
  overrides.value = new Map(((days as { day: string; ranges: ShiftRanges }[] | null) ?? []).map((d) => [d.day, d.ranges]))
  allowance.value = allow ? Number((allow as { days_per_year: number }).days_per_year) : DEFAULT_LEAVE_DAYS
  absences.value = (abs as Absence[] | null) ?? []
  const shut = new Set<string>()
  for (const b of (blocks as { starts_at: string; ends_at: string }[] | null) ?? []) {
    for (let d = new Date(b.starts_at); d < new Date(b.ends_at); d.setUTCDate(d.getUTCDate() + 1)) {
      const noon = new Date(`${clinicDateOf(d, props.timeZone)}T12:00:00Z`)
      if (noon >= new Date(b.starts_at) && noon < new Date(b.ends_at)) shut.add(clinicDateOf(d, props.timeZone))
    }
  }
  closed.value = shut
}
onMounted(load)

const usedDays = computed(() => absences.value.filter((a) => a.status === 'approved' && a.kind === 'vacation').reduce((s, a) => s + leaveWorkingDays(a.starts_on, a.ends_on, a.half_day, closed.value), 0))
const left = computed(() => allowance.value - usedDays.value)
const absenceOn = (date: string) => absences.value.find((a) => a.status === 'approved' && a.starts_on <= date && a.ends_on >= date) ?? null
const shiftOn = (date: string) => (member.value ? shiftForDay(date, member.value, clinicHours.value, overrides.value.get(date)) : null)
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const dates = (a: Absence) => {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (isOpenEndedAbsence(a.ends_on)) return t(`From ${f(a.starts_on)}, no return date yet`, `Desde el ${f(a.starts_on)}, sin fecha de vuelta`)
  return a.starts_on === a.ends_on ? `${f(a.starts_on)}${a.half_day ? t(' (half day)', ' (medio día)') : ''}` : `${f(a.starts_on)} – ${f(a.ends_on)}`
}
const statusPill = (s: string) => (s === 'approved' ? { label: t('Approved', 'Aprobada'), cls: 'bg-success-bg text-success-text' } : s === 'rejected' ? { label: t('Rejected', 'Rechazada'), cls: 'bg-danger-bg text-danger-text' } : { label: t('Pending', 'Pendiente'), cls: 'bg-warning-bg text-warning-text' })

async function withdraw(a: Absence) {
  const { error: e } = await supabase.rpc('cancel_staff_absence', { p_absence_id: a.id })
  if (e) error.value = e.message
  await load()
}

// ---- asking
const asking = ref(false)
const form = reactive({ kind: 'vacation' as string, from: '', to: '', halfDay: false, note: '' })
const busy = ref(false)
const error = ref('')
const sent = ref('')
const askDays = computed(() => (form.from && form.to && form.to >= form.from ? leaveWorkingDays(form.from, form.to, form.halfDay && form.from === form.to, closed.value) : 0))
watch(() => [form.from, form.to], () => {
  if (form.from && (!form.to || form.to < form.from)) form.to = form.from
  if (form.from !== form.to) form.halfDay = false
})
async function ask() {
  error.value = ''
  if (!form.from || !form.to) {
    error.value = t('Choose the days.', 'Elige los días.')
    return
  }
  busy.value = true
  try {
    await authedFetch('/api/staff-absences', { method: 'POST', body: { kind: form.kind, startsOn: form.from, endsOn: form.to, halfDay: form.halfDay && form.from === form.to, note: form.note } })
    sent.value = t('Sent to the owner. You will get a notification when it is decided.', 'Enviada al propietario. Te llegará un aviso cuando la decida.')
    asking.value = false
    Object.assign(form, { kind: 'vacation', from: '', to: '', halfDay: false, note: '' })
    await load()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't send it.", 'No se ha podido enviar.')
  } finally {
    busy.value = false
  }
}
const field = 'h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900'
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="my-leave">
    <div class="flex justify-between rounded-card border border-line bg-surface p-4">
      <div>
        <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Holiday', 'Vacaciones') }}</p>
        <p class="mt-1 font-mono text-[20px] font-semibold text-ink-900" data-cy="my-leave-left">{{ left }} {{ t('days', 'días') }}</p>
        <p class="text-[12px] text-ink-muted">{{ t(`left of ${allowance} this year`, `quedan de ${allowance} este año`) }}</p>
      </div>
    </div>

    <div class="rounded-card border border-line bg-surface px-4 py-1">
      <p class="pt-2.5 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('My shifts this week', 'Mis turnos esta semana') }}</p>
      <div v-for="d in week" :key="d" class="flex items-center justify-between gap-2 border-b border-line-divider py-2 text-[13.5px] last:border-b-0" data-cy="my-shift-day" :data-date="d">
        <span class="capitalize text-ink-900">{{ dayLabel(d) }}</span>
        <span v-if="absenceOn(d)" class="inline-flex h-5 items-center rounded-pill bg-success-bg px-2 text-[11px] font-semibold text-success-text">{{ absenceKindLabel(absenceOn(d)!.kind, t) }}</span>
        <span v-else-if="shiftOn(d) === null" class="text-[12.5px] text-ink-faint">{{ t('No shift set', 'Sin turno') }}</span>
        <span v-else-if="!shiftOn(d)!.length" class="text-[12.5px] text-ink-faint">{{ t('Off', 'Libre') }}</span>
        <span v-else class="font-mono text-[12.5px] text-ink-muted">{{ formatShift(shiftOn(d)!) }}</span>
      </div>
    </div>

    <p v-if="sent" role="status" class="rounded-ctl bg-success-bg px-3 py-2 text-[13px] text-success-text" data-cy="my-leave-sent">{{ sent }}</p>

    <div v-if="absences.length" class="rounded-card border border-line bg-surface px-4 py-1">
      <p class="pt-2.5 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('My requests', 'Mis solicitudes') }}</p>
      <div v-for="a in absences" :key="a.id" class="flex items-center justify-between gap-2 border-b border-line-divider py-2 text-[13.5px] last:border-b-0" data-cy="my-leave-request" :data-status="a.status">
        <span class="min-w-0 text-ink-900">{{ dates(a) }} · {{ absenceKindLabel(a.kind, t) }}</span>
        <span class="flex shrink-0 items-center gap-2">
          <button v-if="a.status === 'pending'" type="button" class="text-[12px] font-semibold text-brand-text" data-cy="my-leave-withdraw" @click="withdraw(a)">{{ t('Withdraw', 'Retirar') }}</button>
          <span class="inline-flex h-5 items-center rounded-pill px-2 text-[11px] font-semibold" :class="statusPill(a.status).cls">{{ statusPill(a.status).label }}</span>
        </span>
      </div>
    </div>

    <UiBtn v-if="!asking" variant="primary" size="lg" data-cy="my-leave-ask" @click="asking = true; sent = ''">{{ t('Ask for holiday or leave', 'Pedir vacaciones o ausencia') }}</UiBtn>
    <form v-else class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4" data-cy="my-leave-form" @submit.prevent="ask">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Type', 'Tipo') }}</p>
      <div class="grid grid-cols-2 gap-1.5">
        <button v-for="k in ABSENCE_KINDS" :key="k" type="button" class="h-10 rounded-ctl border text-[13.5px] font-semibold" :class="form.kind === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'" :aria-pressed="form.kind === k" :data-cy="`my-leave-kind-${k}`" @click="form.kind = k">{{ absenceKindLabel(k, t) }}</button>
      </div>
      <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('From', 'Desde') }}<input v-model="form.from" type="date" :class="field" data-cy="my-leave-from" /></label>
      <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('To', 'Hasta') }}<input v-model="form.to" type="date" :min="form.from" :class="field" data-cy="my-leave-to" /></label>
      <label v-if="form.from && form.from === form.to" class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="form.halfDay" type="checkbox" data-cy="my-leave-half" />{{ t('Half a day only', 'Solo medio día') }}</label>
      <p v-if="askDays" class="text-[12.5px] text-ink-muted" data-cy="my-leave-count">
        {{ askDays }} {{ t('working days', 'días laborables') }}<template v-if="form.kind === 'vacation'"> · {{ t(`you would have ${left - askDays} left`, `te quedarían ${left - askDays}`) }}</template>
      </p>
      <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('Note (optional)', 'Nota (opcional)') }}<input v-model="form.note" :class="field" data-cy="my-leave-note" /></label>
      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
      <div class="flex gap-2">
        <UiBtn size="lg" class="flex-1" @click="asking = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" size="lg" type="submit" class="flex-1" :disabled="busy" data-cy="my-leave-send">{{ t('Send to the owner', 'Enviar al propietario') }}</UiBtn>
      </div>
    </form>
  </div>
</template>
