<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const emit = defineEmits<{ close: [] }>()
const supabase = useSupabaseClient()
const store = useAccountStore()

const loading = ref(true)
const cashPaymentsCents = ref(0)
const movements = ref<Tables<'cash_movements'>[]>([])

const type = ref<'cash_in' | 'cash_out'>('cash_in')
const amount = ref('')
const note = ref('')
const saving = ref(false)
const error = ref('')

function todayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return { start, end }
}

async function load() {
  loading.value = true
  const { start, end } = todayBounds()
  const [{ data: payments }, { data: moves }] = await Promise.all([
    supabase.from('payments').select('amount_cents').eq('method', 'cash').gte('paid_at', start.toISOString()).lte('paid_at', end.toISOString()),
    supabase.from('cash_movements').select('*').gte('created_at', start.toISOString()).lte('created_at', end.toISOString()).order('created_at', { ascending: false }),
  ])
  cashPaymentsCents.value = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  movements.value = moves ?? []
  loading.value = false
}
onMounted(load)

const movementsInCents = computed(() => movements.value.filter((m) => m.type === 'cash_in').reduce((s, m) => s + m.amount_cents, 0))
const movementsOutCents = computed(() => movements.value.filter((m) => m.type === 'cash_out').reduce((s, m) => s + m.amount_cents, 0))
const totalCents = computed(() => cashPaymentsCents.value + movementsInCents.value - movementsOutCents.value)

function fmt(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
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
    <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900">Cash Shift</h3>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>
      <p class="mt-1 text-xs text-gray-400">Today, across the whole account.</p>

      <div v-if="loading" class="mt-4 text-sm text-gray-400">Loading…</div>
      <template v-else>
        <div class="mt-4 rounded-md bg-gray-50 p-3 text-sm">
          <div class="flex justify-between text-gray-500"><span>Cash payments today</span><span>{{ fmt(cashPaymentsCents) }}</span></div>
          <div class="flex justify-between text-gray-500"><span>Cash in</span><span>{{ fmt(movementsInCents) }}</span></div>
          <div class="flex justify-between text-gray-500"><span>Cash out</span><span>-{{ fmt(movementsOutCents) }}</span></div>
          <div class="mt-1.5 flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900"><span>Expected in drawer</span><span>{{ fmt(totalCents) }}</span></div>
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

        <div v-if="movements.length > 0" class="mt-4 max-h-40 space-y-1.5 overflow-y-auto border-t border-gray-100 pt-3 text-xs text-gray-500">
          <div v-for="m in movements" :key="m.id" class="flex justify-between">
            <span>
              {{ new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }} —
              {{ m.type === 'cash_in' ? 'Cash in' : 'Cash out' }}<span v-if="m.note"> ({{ m.note }})</span>
            </span>
            <span>{{ m.type === 'cash_out' ? '-' : '' }}{{ fmt(m.amount_cents) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
