<script setup lang="ts">
import { absenceKindLabel, leaveWorkingDays, DEFAULT_LEAVE_DAYS } from '../../utils/staffShifts'

// Leave requests waiting for an owner, on the Turnos tab (web) and "Mi
// jornada" (app): who, what, which days, how many holiday days they would
// have left, and how many visits they have booked those days. Approving
// blocks their calendar (decide_staff_absence) and tells them; the caller
// hears how many visits are left to move ("Ausencia imprevista").
const props = defineProps<{ accountId: string }>()
const emit = defineEmits<{ decided: [payload: { absence: { id: string; team_member_id: string; starts_on: string; ends_on: string; status: string }; visits: number }] }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()

interface Pending { id: string; team_member_id: string; kind: string; starts_on: string; ends_on: string; half_day: boolean; note: string | null; team_members: { full_name: string } | null }
const pending = ref<Pending[]>([])
const remaining = ref<Map<string, number>>(new Map())
const visits = ref<Map<string, number>>(new Map())
const busy = ref<string | null>(null)
const error = ref('')

async function load() {
  const year = new Date().getFullYear()
  const [{ data: ps }, { data: approved }, { data: allowances }] = await Promise.all([
    supabase.from('staff_absences').select('id, team_member_id, kind, starts_on, ends_on, half_day, note, team_members!staff_absences_team_member_id_fkey(full_name)').eq('account_id', props.accountId).eq('status', 'pending').order('starts_on'),
    supabase.from('staff_absences').select('team_member_id, starts_on, ends_on, half_day').eq('account_id', props.accountId).eq('status', 'approved').eq('kind', 'vacation').gte('starts_on', `${year}-01-01`).lte('starts_on', `${year}-12-31`),
    supabase.from('staff_leave_allowances').select('team_member_id, days_per_year').eq('account_id', props.accountId),
  ])
  pending.value = (ps as unknown as Pending[] | null) ?? []
  const used = new Map<string, number>()
  for (const a of approved ?? []) used.set(a.team_member_id, (used.get(a.team_member_id) ?? 0) + leaveWorkingDays(a.starts_on, a.ends_on, a.half_day))
  const allowance = new Map((allowances ?? []).map((a) => [a.team_member_id, Number(a.days_per_year)]))
  remaining.value = new Map(pending.value.map((p) => [p.team_member_id, (allowance.get(p.team_member_id) ?? DEFAULT_LEAVE_DAYS) - (used.get(p.team_member_id) ?? 0)]))
  // Visits each person has booked on the days asked for.
  const counts = await Promise.all(pending.value.map((p) => supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('practitioner_id', p.team_member_id).eq('status', 'booked').is('deleted_at', null).gte('starts_at', `${p.starts_on}T00:00:00`).lt('starts_at', `${p.ends_on}T23:59:59`)))
  visits.value = new Map(pending.value.map((p, i) => [p.id, counts[i]!.count ?? 0]))
}
onMounted(load)
defineExpose({ load })

const dates = (p: Pending) => {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return p.starts_on === p.ends_on ? `${f(p.starts_on)}${p.half_day ? t(' (half day)', ' (medio día)') : ''}` : `${f(p.starts_on)} – ${f(p.ends_on)}`
}

async function decide(p: Pending, approve: boolean) {
  busy.value = p.id
  error.value = ''
  try {
    const r = await authedFetch<{ absence: { id: string; team_member_id: string; starts_on: string; ends_on: string; status: string }; visits: number }>(`/api/staff-absences/${p.id}/decide`, { method: 'POST', body: { approve } })
    emit('decided', r)
    await load()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't decide it.", 'No se ha podido decidir.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section v-if="pending.length" class="rounded-card border border-warning-border bg-warning-bg2 px-4 py-3" data-cy="leave-pending">
    <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Requests waiting', 'Solicitudes pendientes') }} · {{ pending.length }}</h2>
    <p v-if="error" role="alert" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
    <div v-for="p in pending" :key="p.id" class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-cy="leave-pending-row" :data-name="p.team_members?.full_name">
      <span class="text-[13.5px] font-semibold text-ink-900">{{ p.team_members?.full_name }}</span>
      <span class="min-w-0 flex-1 text-[12.5px] text-ink-muted">
        {{ absenceKindLabel(p.kind, t) }} · {{ dates(p) }} ·
        {{ leaveWorkingDays(p.starts_on, p.ends_on, p.half_day) }} {{ t('working days', 'días laborables') }}
        <template v-if="p.kind === 'vacation'"> · {{ t(`${remaining.get(p.team_member_id) ?? DEFAULT_LEAVE_DAYS} left`, `le quedan ${remaining.get(p.team_member_id) ?? DEFAULT_LEAVE_DAYS}`) }}</template>
        <template v-if="visits.get(p.id)"> · <strong class="text-warning-text" data-cy="leave-pending-visits">{{ t(`${visits.get(p.id)} visits booked those days`, `tiene ${visits.get(p.id)} visitas esos días`) }}</strong></template>
        <template v-if="p.note"> · «{{ p.note }}»</template>
      </span>
      <span class="flex gap-2">
        <UiBtn size="sm" :disabled="busy === p.id" data-cy="leave-reject" @click="decide(p, false)">{{ t('Reject', 'Rechazar') }}</UiBtn>
        <UiBtn size="sm" variant="primary" :disabled="busy === p.id" data-cy="leave-approve" @click="decide(p, true)">{{ t('Approve and block the calendar', 'Aprobar y bloquear agenda') }}</UiBtn>
      </span>
    </div>
  </section>
</template>
