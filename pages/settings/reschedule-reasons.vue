<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const reasons = ref<Tables<'reschedule_reasons'>[]>([])
const loading = ref(true)
const name = ref('')
const saving = ref(false)
const error = ref('')

const rescheduleFeeAmount = ref('')
const cancellationFeeAmount = ref('')
const missedFeeAmount = ref('')
const feeSaving = ref(false)

function toAmount(cents: number | null) {
  return cents != null ? (cents / 100).toFixed(2) : ''
}
function toCents(amount: string) {
  return amount.trim() ? Math.round(parseFloat(amount) * 100) : null
}

async function load() {
  loading.value = true
  const [{ data: reasonRows }, { data: account }] = await Promise.all([
    supabase.from('reschedule_reasons').select('*').order('name'),
    supabase.from('accounts').select('scheduling_policy_fee_cents, cancellation_fee_cents, missed_appointment_fee_cents').eq('id', store.accountId!).maybeSingle(),
  ])
  reasons.value = reasonRows ?? []
  rescheduleFeeAmount.value = toAmount(account?.scheduling_policy_fee_cents ?? null)
  cancellationFeeAmount.value = toAmount(account?.cancellation_fee_cents ?? null)
  missedFeeAmount.value = toAmount(account?.missed_appointment_fee_cents ?? null)
  loading.value = false
}
onMounted(load)

async function addReason() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('reschedule_reasons').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function removeReason(id: string) {
  if (!confirm('Delete this reschedule reason?')) return
  await supabase.from('reschedule_reasons').delete().eq('id', id)
  await load()
}

async function saveFees() {
  feeSaving.value = true
  await supabase
    .from('accounts')
    .update({
      scheduling_policy_fee_cents: toCents(rescheduleFeeAmount.value),
      cancellation_fee_cents: toCents(cancellationFeeAmount.value),
      missed_appointment_fee_cents: toCents(missedFeeAmount.value),
    })
    .eq('id', store.accountId!)
  feeSaving.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Scheduling Policies" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Flat fees for reschedule, cancellation, and missed appointments, plus the reasons staff pick when dragging an appointment to a new time.</p>

          <form class="mt-4 space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="saveFees">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Reschedule fee (€)</label>
                <input v-model="rescheduleFeeAmount" type="number" min="0" step="0.01" placeholder="e.g. 15.00" class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Cancellation fee (€)</label>
                <input v-model="cancellationFeeAmount" type="number" min="0" step="0.01" placeholder="e.g. 25.00" class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">Missed appointment fee (€)</label>
                <input v-model="missedFeeAmount" type="number" min="0" step="0.01" placeholder="e.g. 25.00" class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
              </div>
            </div>
            <UiBtn variant="primary" type="submit" :disabled="feeSaving">{{ feeSaving ? 'Saving…' : 'Save Fees' }}</UiBtn>
            <p class="text-[12px] text-ink-muted2">
              Reschedule is offered on the reschedule confirmation dialog. Cancellation and missed-appointment fees are offered when staff change an appointment's status from the Edit Appointment modal.
            </p>
          </form>

          <div class="mt-6 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Reschedule reason</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="2" class="px-4 py-6 text-center text-ink-faint">Loading…</td>
                </tr>
                <tr v-else-if="reasons.length === 0">
                  <td colspan="2" class="px-4 py-6 text-center text-ink-faint">No reschedule reasons yet.</td>
                </tr>
                <tr v-for="r in reasons" :key="r.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ r.name }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeReason(r.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addReason">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Name</label>
              <input v-model="name" type="text" required placeholder="Patient request" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Reason' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
