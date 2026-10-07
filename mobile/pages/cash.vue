<script setup lang="ts">
// Caja: today's cash shift at the front desk -- the web's CashShiftModal
// (components/CashShiftModal.vue), with its reads and writes, gated as the web
// gates it (payments_allocate). What was charged and collected this shift by
// method, money that settled something without coming in, finished visits
// with nothing charged, the drawer (cash payments + cash in - cash out),
// cash in/out movements, and closing the shift with a note.
//
// The shift is a daily boundary, as on the web: one left open from an
// earlier day closes itself at the rollover, and if none is open, one opens
// stamped at the start of today. "Today" is the clinic's day here, in its
// time zone (the web uses the browser's).
import { formatEur } from '../../utils/billing'
import { isReceipt } from '../../utils/paymentReceipts'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Shift { id: string; opened_at: string; note: string | null }
interface Movement { id: string; type: 'cash_in' | 'cash_out'; amount_cents: number; note: string | null; created_at: string }

const supabase = useSupabaseClient()
const t = useT()
const router = useRouter()
const { context, loading: contextLoading, can } = usePractitionerContext()
const allowed = computed(() => can('payments_allocate'))
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)

const loading = ref(true)
const loadError = ref('')
const shift = ref<Shift | null>(null)
const invoicedCents = ref(0)
const paidByMethod = ref<{ method: string; cents: number }[]>([])
const settledWithoutMoney = ref<{ method: string; cents: number }[]>([])
const cashPaymentsCents = ref(0)
const movements = ref<Movement[]>([])
const unprocessed = ref<{ appointmentId: string; patientId: string; name: string; startsAt: string }[]>([])

const METHOD_LABEL = computed<Record<string, string>>(() => ({
  card: t('Card', 'Tarjeta'),
  cash: t('Cash', 'Efectivo'),
  transfer: t('Transfer', 'Transferencia'),
  bizum: 'Bizum',
  other: t('Other', 'Otro'),
  credit: t('Credit on account', 'Crédito en cuenta'),
  write_off: t('Write-off', 'Baja contable'),
}))

const todayKey = () => clinicDateOf(new Date(), tz.value)
const isToday = (iso: string) => clinicDateOf(new Date(iso), tz.value) === todayKey()

async function loadOpenShift() {
  const { data, error } = await supabase
    .from('cash_shifts')
    .select('id, opened_at, note')
    .eq('account_id', context.value!.accountId)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  shift.value = data as Shift | null
}

async function ensureTodayShift() {
  const me = context.value!.teamMemberId
  if (shift.value && !isToday(shift.value.opened_at)) {
    await supabase
      .from('cash_shifts')
      .update({ closed_at: new Date().toISOString(), closed_by: me, note: shift.value.note ?? 'Auto-closed at day rollover' } as never)
      .eq('id', shift.value.id)
    shift.value = null
  }
  if (!shift.value) {
    // From the start of the clinic's today, so nothing taken before the
    // first look at this screen is missed.
    await supabase.from('cash_shifts').insert({ account_id: context.value!.accountId, opened_by: me, opened_at: startOfLocalDate(todayKey(), tz.value).toISOString() } as never)
    await loadOpenShift()
  }
}

let run = 0
async function load() {
  if (!context.value || !allowed.value) return
  const mine = ++run
  loading.value = true
  loadError.value = ''
  try {
    await loadOpenShift()
    await ensureTodayShift()
  } catch {
    loadError.value = t('Could not open today’s shift.', 'No se ha podido abrir el turno de hoy.')
    loading.value = false
    return
  }
  if (mine !== run || !shift.value) {
    loading.value = false
    return
  }
  const accountId = context.value.accountId
  const openedAt = shift.value.opened_at
  const [inv, pays, appts, moves] = await Promise.all([
    // A void receipt charges nobody anything.
    supabase.from('invoices').select('total_cents').eq('account_id', accountId).neq('status', 'void').gte('created_at', openedAt),
    supabase.from('payments').select('amount_cents, method').eq('account_id', accountId).gte('paid_at', openedAt),
    supabase.from('appointments').select('id, starts_at, patient_id, patients(first_name, last_name)').eq('account_id', accountId).eq('status', 'completed').gte('starts_at', openedAt),
    supabase.from('cash_movements').select('id, type, amount_cents, note, created_at').eq('account_id', accountId).gte('created_at', openedAt).order('created_at', { ascending: false }),
  ])
  if (mine !== run) return
  if (inv.error || pays.error || appts.error || moves.error) {
    loadError.value = t('Could not load the shift.', 'No se ha podido cargar el turno.')
    loading.value = false
    return
  }
  invoicedCents.value = ((inv.data as { total_cents: number }[]) ?? []).reduce((s, i) => s + i.total_cents, 0)
  // Collected is money that came in (utils/paymentReceipts): credit spent
  // and debts written off settle receipts but are not takings.
  const totals = new Map<string, number>()
  for (const p of (pays.data as { amount_cents: number; method: string }[]) ?? []) totals.set(p.method, (totals.get(p.method) ?? 0) + p.amount_cents)
  const byMethod = [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
  paidByMethod.value = byMethod.filter((m) => isReceipt(m.method))
  settledWithoutMoney.value = byMethod.filter((m) => !isReceipt(m.method))
  cashPaymentsCents.value = totals.get('cash') ?? 0
  movements.value = (moves.data as Movement[]) ?? []

  // Finished visits with no standing charge: the one that stands decides
  // (paid over open, either over void), as on the web.
  const done = (appts.data as unknown as { id: string; starts_at: string; patient_id: string; patients: { first_name: string; last_name: string | null } | null }[]) ?? []
  const byAppt = new Map<string, string>()
  if (done.length) {
    const { data: apptInvoices } = await supabase.from('invoices').select('appointment_id, status').in('appointment_id', done.map((a) => a.id))
    const weight = (s: string) => (s === 'paid' ? 2 : s === 'void' ? 0 : 1)
    for (const i of (apptInvoices as { appointment_id: string | null; status: string }[]) ?? []) {
      if (!i.appointment_id) continue
      const seen = byAppt.get(i.appointment_id)
      if (!seen || weight(i.status) > weight(seen)) byAppt.set(i.appointment_id, i.status)
    }
  }
  if (mine !== run) return
  unprocessed.value = done
    .filter((a) => {
      const s = byAppt.get(a.id)
      return !s || (s !== 'paid' && s !== 'void')
    })
    .map((a) => ({ appointmentId: a.id, patientId: a.patient_id, name: a.patients ? `${a.patients.first_name} ${a.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido'), startsAt: a.starts_at }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  loading.value = false
}
watch([() => context.value?.accountId, allowed], load, { immediate: true })

const movementsIn = computed(() => movements.value.filter((m) => m.type === 'cash_in').reduce((s, m) => s + m.amount_cents, 0))
const movementsOut = computed(() => movements.value.filter((m) => m.type === 'cash_out').reduce((s, m) => s + m.amount_cents, 0))
const expectedInDrawer = computed(() => cashPaymentsCents.value + movementsIn.value - movementsOut.value)
const totalCollected = computed(() => paidByMethod.value.reduce((s, m) => s + m.cents, 0))
const hhmm = (iso: string) => clinicTimeLabel(new Date(iso), tz.value)

// -- Cash in / out ------------------------------------------------------------
const type = ref<'cash_in' | 'cash_out'>('cash_in')
const amount = ref('')
const note = ref('')
const saving = ref(false)
const error = ref('')
async function addMovement() {
  if (saving.value || !context.value) return
  error.value = ''
  const cents = Math.round((parseFloat(String(amount.value).replace(',', '.')) || 0) * 100)
  if (cents <= 0) {
    error.value = t('Enter an amount.', 'Introduce un importe.')
    return
  }
  saving.value = true
  const { error: e } = await supabase.from('cash_movements').insert({
    account_id: context.value.accountId,
    clinic_id: context.value.clinicId,
    team_member_id: context.value.teamMemberId,
    type: type.value,
    amount_cents: cents,
    note: note.value.trim() || null,
  } as never)
  saving.value = false
  if (e) {
    error.value = e.message
    return
  }
  amount.value = ''
  note.value = ''
  load()
}

// -- Close ---------------------------------------------------------------------
const closeNote = ref('')
const closing = ref(false)
const closed = ref(false)
async function closeShift() {
  if (!shift.value || !context.value || closing.value) return
  closing.value = true
  const { error: e } = await supabase
    .from('cash_shifts')
    .update({ closed_at: new Date().toISOString(), closed_by: context.value.teamMemberId, note: closeNote.value.trim() || null } as never)
    .eq('id', shift.value.id)
  closing.value = false
  if (e) {
    error.value = e.message
    return
  }
  closeNote.value = ''
  closed.value = true
  shift.value = null
}
const row = 'flex items-center justify-between gap-3 text-[14px]'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="cash">
    <AppPageHeader :title="t('Cash shift', 'Caja')" back @back="router.back()" />

    <p v-if="!contextLoading && !allowed" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('Your role does not take payments.', 'Tu rol no registra cobros.') }}</p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)">
      <div class="mx-auto flex max-w-[640px] flex-col gap-2.5">
        <AppSkeletonList v-if="contextLoading || loading" :rows="4" />
        <p v-else-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">
          {{ loadError }} <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <div v-else-if="closed" class="mt-8 flex flex-col items-center px-6 text-center" data-cy="cash-closed">
          <p class="text-[16px] font-semibold text-ink-900">{{ t('Shift closed.', 'Turno cerrado.') }}</p>
          <p class="mt-1 text-[13px] text-ink-muted">{{ t('A new one opens itself the next time anyone looks.', 'Se abre uno nuevo la próxima vez que alguien entre.') }}</p>
        </div>
        <template v-else-if="shift">
          <p class="px-1 text-[12.5px] leading-snug text-ink-muted">
            {{ t(`Today’s shift, open since ${hhmm(shift.opened_at)}. It closes itself overnight; close it now only to leave a note.`, `Turno de hoy, abierto desde las ${hhmm(shift.opened_at)}. Se cierra solo por la noche; ciérralo ahora solo si quieres dejar una nota.`) }}
          </p>

          <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="cash-totals">
            <div :class="row" class="text-ink-muted"><span>{{ t('Charged this shift', 'Cargado en este turno') }}</span><span class="tabular-nums">{{ formatEur(invoicedCents) }}</span></div>
            <div :class="row" class="mt-1.5 border-t border-line-row pt-1.5 font-semibold text-ink-900"><span>{{ t('Total collected', 'Total cobrado') }}</span><span class="tabular-nums" data-cy="cash-collected">{{ formatEur(totalCollected) }}</span></div>
            <div v-for="m in paidByMethod" :key="m.method" :class="row" class="mt-1 text-[13px] text-ink-muted"><span>{{ METHOD_LABEL[m.method] ?? m.method }}</span><span class="tabular-nums">{{ formatEur(m.cents) }}</span></div>
            <template v-if="settledWithoutMoney.length">
              <p class="mt-2 border-t border-line-row pt-2 text-[12px] text-ink-faint">{{ t('Settled without money coming in (not in the total):', 'Saldado sin entrada de dinero (no incluido en el total):') }}</p>
              <div v-for="m in settledWithoutMoney" :key="m.method" :class="row" class="text-[12.5px] text-ink-faint"><span>{{ METHOD_LABEL[m.method] ?? m.method }}</span><span class="tabular-nums">{{ formatEur(m.cents) }}</span></div>
            </template>
          </section>

          <section v-if="unprocessed.length" class="rounded-card border border-warning-border bg-warning-bg px-3.5 py-3" data-cy="cash-unprocessed">
            <p class="text-[13px] font-semibold text-warning-text">{{ unprocessed.length === 1 ? t('1 finished visit with nothing charged', '1 visita terminada sin cobrar') : t(`${unprocessed.length} finished visits with nothing charged`, `${unprocessed.length} visitas terminadas sin cobrar`) }}</p>
            <NuxtLink v-for="a in unprocessed" :key="a.appointmentId" :to="`/calendar/${a.appointmentId}`" class="mt-1 flex min-h-9 items-center justify-between gap-2 text-[13.5px] text-warning-text underline-offset-2">
              <span class="truncate">{{ hhmm(a.startsAt) }} · {{ a.name }}</span>
              <AppChevron :size="12" />
            </NuxtLink>
          </section>

          <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="cash-drawer">
            <p class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Cash drawer', 'Caja registradora') }}</p>
            <div :class="row" class="mt-1.5 text-ink-muted"><span>{{ t('Cash payments', 'Pagos en efectivo') }}</span><span class="tabular-nums">{{ formatEur(cashPaymentsCents) }}</span></div>
            <div :class="row" class="text-ink-muted"><span>{{ t('Cash in', 'Entradas') }}</span><span class="tabular-nums">{{ formatEur(movementsIn) }}</span></div>
            <div :class="row" class="text-ink-muted"><span>{{ t('Cash out', 'Salidas') }}</span><span class="tabular-nums">-{{ formatEur(movementsOut) }}</span></div>
            <div :class="row" class="mt-1.5 border-t border-line-row pt-1.5 text-[15px] font-semibold text-ink-900"><span>{{ t('Expected in drawer', 'Esperado en caja') }}</span><span class="tabular-nums" data-cy="cash-expected">{{ formatEur(expectedInDrawer) }}</span></div>

            <form class="mt-3 flex flex-col gap-2 border-t border-line-row pt-3" @submit.prevent="addMovement">
              <div role="tablist" class="grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px]">
                <button v-for="k in (['cash_in', 'cash_out'] as const)" :key="k" type="button" role="tab" :aria-selected="type === k" class="h-8 rounded-ctlSm text-[13px] font-semibold" :class="type === k ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`cash-type-${k}`" @click="type = k">
                  {{ k === 'cash_in' ? t('Cash in', 'Entrada') : t('Cash out', 'Salida') }}
                </button>
              </div>
              <div class="flex gap-2">
                <input v-model="amount" type="text" inputmode="decimal" :placeholder="t('Amount €', 'Importe €')" class="h-11 w-28 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="cash-amount" />
                <input v-model="note" type="text" :placeholder="t('Note, e.g. bank drop', 'Nota, p. ej. ingreso en banco')" class="h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="cash-note" />
              </div>
              <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
              <button type="submit" class="flex h-10 items-center justify-center rounded-ctl bg-brand text-[14px] font-semibold text-white disabled:opacity-50" :disabled="saving" data-cy="cash-add">{{ saving ? t('Saving…', 'Guardando…') : t('Add', 'Añadir') }}</button>
            </form>

            <ul v-if="movements.length" class="mt-3 space-y-1 border-t border-line-row pt-2" data-cy="cash-movements">
              <li v-for="m in movements" :key="m.id" class="flex justify-between gap-3 text-[12.5px] text-ink-muted">
                <span class="min-w-0 truncate">{{ hhmm(m.created_at) }} · {{ m.type === 'cash_in' ? t('In', 'Entrada') : t('Out', 'Salida') }}<template v-if="m.note"> · {{ m.note }}</template></span>
                <span class="shrink-0 tabular-nums">{{ m.type === 'cash_out' ? '-' : '' }}{{ formatEur(m.amount_cents) }}</span>
              </li>
            </ul>
          </section>

          <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card">
            <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
              {{ t('End of shift note', 'Nota de fin de turno') }}
              <input v-model="closeNote" type="text" :placeholder="t('Optional', 'Opcional')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="cash-close-note" />
            </label>
            <button type="button" class="mt-2 flex h-11 w-full items-center justify-center rounded-card bg-ink-900 text-[14.5px] font-semibold text-surface disabled:opacity-50" :disabled="closing" data-cy="cash-close" @click="closeShift">{{ closing ? t('Closing…', 'Cerrando…') : t('Close shift', 'Cerrar turno') }}</button>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>
