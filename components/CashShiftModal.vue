<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const emit = defineEmits<{ close: [] }>()
const supabase = useSupabaseClient()
const store = useAccountStore()

const loading = ref(true)
const shift = ref<Tables<'cash_shifts'> | null>(null)
const opening = ref(false)

const invoicedCents = ref(0)
const paidByMethod = ref<{ method: string; cents: number }[]>([])
const unprocessed = ref<{ appointmentId: string; patientId: string; patientName: string; startsAt: string }[]>([])

const cashPaymentsCents = ref(0)
const movements = ref<Tables<'cash_movements'>[]>([])

const type = ref<'cash_in' | 'cash_out'>('cash_in')
const amount = ref('')
const note = ref('')
const saving = ref(false)
const error = ref('')

const closeNote = ref('')
const closing = ref(false)

const METHOD_LABEL: Record<string, string> = { card: 'Card', cash: 'Cash', other: 'Other', credit: 'Credit on account', write_off: 'Write-off' }

async function loadOpenShift() {
  const { data } = await supabase
    .from('cash_shifts')
    .select('*')
    .eq('account_id', store.accountId!)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  shift.value = data
}

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

// The shift is now a daily boundary rather than something staff has to
// remember to open every morning: a shift left open from a previous day
// rolls over into today's automatically, and if none is open at all, one
// opens right here. Staff only ever has to press "Close Shift" -- and only
// if they want to leave an end-of-day note -- since tomorrow's view opens
// itself either way.
async function ensureTodayShift() {
  if (!store.teamMember) return
  if (shift.value && !isToday(shift.value.opened_at)) {
    await supabase
      .from('cash_shifts')
      .update({ closed_at: new Date().toISOString(), closed_by: store.teamMember.id, note: shift.value.note ?? 'Auto-closed at day rollover' })
      .eq('id', shift.value.id)
    shift.value = null
  }
  if (!shift.value) {
    // Stamped at the start of today, not the moment of this click -- staff
    // rarely opens this modal at 00:00, and a shift that only starts
    // counting from whenever someone first checks it would silently miss
    // every invoice/payment from earlier that same day.
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    await supabase.from('cash_shifts').insert({ account_id: store.accountId!, opened_by: store.teamMember.id, opened_at: startOfToday })
    await loadOpenShift()
  }
}

async function load() {
  loading.value = true
  await loadOpenShift()
  await ensureTodayShift()
  if (!shift.value) {
    loading.value = false
    return
  }
  const openedAt = shift.value.opened_at

  const [{ data: invoices }, { data: payments }, { data: appointments }, { data: moves }] = await Promise.all([
    supabase.from('invoices').select('total_cents').eq('account_id', store.accountId!).gte('created_at', openedAt),
    supabase.from('payments').select('amount_cents, method, invoice_id').eq('account_id', store.accountId!).gte('paid_at', openedAt),
    supabase
      .from('appointments')
      .select('id, starts_at, patient_id, patients(first_name, last_name)')
      .eq('account_id', store.accountId!)
      .eq('status', 'completed')
      .gte('starts_at', openedAt),
    supabase.from('cash_movements').select('*').eq('account_id', store.accountId!).gte('created_at', openedAt).order('created_at', { ascending: false }),
  ])

  invoicedCents.value = (invoices ?? []).reduce((sum, i) => sum + i.total_cents, 0)

  const methodTotals = new Map<string, number>()
  for (const p of payments ?? []) methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + p.amount_cents)
  paidByMethod.value = [...methodTotals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)

  cashPaymentsCents.value = methodTotals.get('cash') ?? 0

  const appointmentIds = (appointments ?? []).map((a) => a.id)
  const invoiceByAppointment = new Map<string, { status: string }>()
  if (appointmentIds.length > 0) {
    const { data: apptInvoices } = await supabase.from('invoices').select('appointment_id, status').in('appointment_id', appointmentIds)
    for (const inv of apptInvoices ?? []) {
      if (inv.appointment_id) invoiceByAppointment.set(inv.appointment_id, { status: inv.status })
    }
  }
  unprocessed.value = (appointments ?? [])
    .filter((a) => {
      const inv = invoiceByAppointment.get(a.id)
      return !inv || (inv.status !== 'paid' && inv.status !== 'void')
    })
    .map((a) => {
      const patient = a.patients as unknown as { first_name: string; last_name: string | null } | null
      return {
        appointmentId: a.id,
        patientId: a.patient_id,
        patientName: patient ? `${patient.first_name} ${patient.last_name ?? ''}`.trim() : 'Unknown patient',
        startsAt: a.starts_at,
      }
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  movements.value = moves ?? []
  loading.value = false
}
onMounted(load)

const movementsInCents = computed(() => movements.value.filter((m) => m.type === 'cash_in').reduce((s, m) => s + m.amount_cents, 0))
const movementsOutCents = computed(() => movements.value.filter((m) => m.type === 'cash_out').reduce((s, m) => s + m.amount_cents, 0))
const expectedInDrawerCents = computed(() => cashPaymentsCents.value + movementsInCents.value - movementsOutCents.value)
const totalPaidCents = computed(() => paidByMethod.value.reduce((s, m) => s + m.cents, 0))

function fmt(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}

async function openShift() {
  if (!store.teamMember) return
  opening.value = true
  await supabase.from('cash_shifts').insert({ account_id: store.accountId!, opened_by: store.teamMember.id })
  opening.value = false
  await load()
}

async function closeShift() {
  if (!shift.value || !store.teamMember) return
  closing.value = true
  await supabase
    .from('cash_shifts')
    .update({ closed_at: new Date().toISOString(), closed_by: store.teamMember.id, note: closeNote.value.trim() || null })
    .eq('id', shift.value.id)
  closing.value = false
  closeNote.value = ''
  await load()
}

async function addMovement() {
  error.value = ''
  const cents = Math.round((parseFloat(amount.value) || 0) * 100)
  if (cents <= 0) {
    error.value = 'Enter an amount.'
    return
  }
  if (!store.teamMember) return
  saving.value = true
  const { error: insertError } = await supabase.from('cash_movements').insert({
    account_id: store.accountId!,
    clinic_id: store.currentClinicId,
    team_member_id: store.teamMember.id,
    type: type.value,
    amount_cents: cents,
    note: note.value.trim() || null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  amount.value = ''
  note.value = ''
  await load()
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900">Cash Shift</h3>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="mt-4 text-sm text-gray-400">Loading…</div>

      <div v-else-if="!shift" class="mt-4">
        <p class="text-sm text-gray-500">Couldn't open today's shift automatically.</p>
        <button
          type="button"
          :disabled="opening"
          class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          @click="openShift"
        >
          {{ opening ? 'Opening…' : 'Open Shift' }}
        </button>
      </div>

      <template v-else>
        <p class="mt-1 text-xs text-gray-400">
          Today's shift, open since {{ new Date(shift.opened_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }}. Closes itself over into tomorrow --
          only close it now if you want to leave an end-of-day note.
        </p>

        <div class="mt-4 rounded-md bg-gray-50 p-3 text-sm">
          <div class="flex justify-between text-gray-500"><span>Invoiced this shift</span><span>{{ fmt(invoicedCents) }}</span></div>
          <div class="mt-1.5 flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900"><span>Total collected</span><span>{{ fmt(totalPaidCents) }}</span></div>
        </div>

        <div v-if="paidByMethod.length > 0" class="mt-3 space-y-1 text-sm">
          <div v-for="m in paidByMethod" :key="m.method" class="flex justify-between text-gray-500">
            <span>{{ METHOD_LABEL[m.method] ?? m.method }}</span>
            <span>{{ fmt(m.cents) }}</span>
          </div>
        </div>

        <div v-if="unprocessed.length > 0" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p class="font-medium">{{ unprocessed.length }} completed appointment{{ unprocessed.length === 1 ? '' : 's' }} not fully invoiced this shift:</p>
          <ul class="mt-1.5 space-y-1">
            <li v-for="a in unprocessed" :key="a.appointmentId">
              <NuxtLink :to="`/patients/${a.patientId}?tab=billing`" class="underline hover:text-amber-900" @click="emit('close')">
                {{ new Date(a.startsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }} — {{ a.patientName }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <div class="mt-4 rounded-md bg-gray-50 p-3 text-sm">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-400">Cash drawer</p>
          <div class="mt-1.5 flex justify-between text-gray-500"><span>Cash payments</span><span>{{ fmt(cashPaymentsCents) }}</span></div>
          <div class="flex justify-between text-gray-500"><span>Cash in</span><span>{{ fmt(movementsInCents) }}</span></div>
          <div class="flex justify-between text-gray-500"><span>Cash out</span><span>-{{ fmt(movementsOutCents) }}</span></div>
          <div class="mt-1.5 flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900"><span>Expected in drawer</span><span>{{ fmt(expectedInDrawerCents) }}</span></div>
        </div>

        <form class="mt-4 flex flex-wrap items-end gap-2" @submit.prevent="addMovement">
          <div>
            <label class="block text-xs font-medium text-gray-500">Type</label>
            <select v-model="type" class="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="cash_in">Cash in</option>
              <option value="cash_out">Cash out</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500">Amount</label>
            <input v-model="amount" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div class="flex-1">
            <label class="block text-xs font-medium text-gray-500">Note</label>
            <input v-model="note" type="text" placeholder="e.g. bank drop" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Add' }}
          </button>
        </form>
        <p v-if="error" class="mt-1.5 text-xs text-red-600">{{ error }}</p>

        <div v-if="movements.length > 0" class="mt-4 max-h-32 space-y-1.5 overflow-y-auto border-t border-gray-100 pt-3 text-xs text-gray-500">
          <div v-for="m in movements" :key="m.id" class="flex justify-between">
            <span>
              {{ new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }} —
              {{ m.type === 'cash_in' ? 'Cash in' : 'Cash out' }}<span v-if="m.note"> ({{ m.note }})</span>
            </span>
            <span>{{ m.type === 'cash_out' ? '-' : '' }}{{ fmt(m.amount_cents) }}</span>
          </div>
        </div>

        <div class="mt-4 border-t border-gray-100 pt-3">
          <label class="block text-xs font-medium text-gray-500">End of shift note</label>
          <input v-model="closeNote" type="text" placeholder="Optional" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          <button
            type="button"
            :disabled="closing"
            class="mt-2 w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            @click="closeShift"
          >
            {{ closing ? 'Closing…' : 'Close Shift' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
