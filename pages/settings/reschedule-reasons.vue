<script setup lang="ts">
import { parseEurosToCents } from '~/utils/appointmentTypes'
import type { Tables } from '~/types/database.types'

// Settings > Scheduling Policies: what a patient can be charged when an
// appointment changes, and the reasons staff give when they move one.
//
// Each fee is offered, never charged by itself: the cancel step
// (CancelStep.vue) offers the cancellation fee, the appointment panel the
// missed-appointment fee, and the reschedule dialog the reschedule fee
// (read from the account store). A null amount is "not offered", which is
// what the switch shows.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

type FeeKey = 'cancellation_fee_cents' | 'missed_appointment_fee_cents' | 'scheduling_policy_fee_cents'
interface Fee {
  key: FeeKey
  title: string
  where: string
}
const FEES = computed<Fee[]>(() => [
  { key: 'cancellation_fee_cents', title: t('Cancellation', 'Cancelación'), where: t('Offered when staff cancel: add it to the balance, or charge the saved card.', 'Se ofrece al cancelar: añadirla al saldo o cobrarla a la tarjeta guardada.') },
  { key: 'missed_appointment_fee_cents', title: t('Missed appointment', 'Cita perdida'), where: t('Offered when an appointment is marked as missed.', 'Se ofrece al marcar una cita como perdida.') },
  { key: 'scheduling_policy_fee_cents', title: t('Reschedule', 'Reprogramación'), where: t('Offered when an appointment is dragged to a new time.', 'Se ofrece al arrastrar una cita a otra hora.') },
])

const feeOn = ref<Record<FeeKey, boolean>>({ cancellation_fee_cents: false, missed_appointment_fee_cents: false, scheduling_policy_fee_cents: false })
const feeAmount = ref<Record<FeeKey, string>>({ cancellation_fee_cents: '', missed_appointment_fee_cents: '', scheduling_policy_fee_cents: '' })
const feeError = ref('')
const feeSaving = ref(false)

const reasons = ref<Tables<'reschedule_reasons'>[]>([])
const uses = ref<Record<string, number>>({})
const loading = ref(true)

function toAmount(cents: number | null) {
  return cents != null ? (cents / 100).toFixed(2).replace('.', ',') : ''
}

async function load() {
  const [{ data: reasonRows }, { data: account }] = await Promise.all([
    supabase.from('reschedule_reasons').select('*').order('name'),
    supabase.from('accounts').select('scheduling_policy_fee_cents, cancellation_fee_cents, missed_appointment_fee_cents').eq('id', store.accountId!).maybeSingle(),
  ])
  reasons.value = reasonRows ?? []
  for (const f of FEES.value) {
    const cents = account?.[f.key] ?? null
    feeOn.value[f.key] = cents != null && cents > 0
    feeAmount.value[f.key] = toAmount(cents)
  }
  loading.value = false
  const counts = await Promise.all(reasons.value.map((r) => supabase.from('appointment_reschedules').select('id', { count: 'exact', head: true }).eq('reason_id', r.id)))
  uses.value = Object.fromEntries(reasons.value.map((r, i) => [r.id, counts[i].count ?? 0]))
}
onMounted(load)

async function saveFees() {
  feeError.value = ''
  const update: Partial<Record<FeeKey, number | null>> = {}
  for (const f of FEES.value) {
    if (!feeOn.value[f.key]) {
      update[f.key] = null
      continue
    }
    const cents = parseEurosToCents(feeAmount.value[f.key])
    if (cents === null || !Number.isFinite(cents) || cents <= 0) {
      feeError.value = t(`${f.title}: an amount above zero, or switch it off.`, `${f.title}: un importe mayor que cero, o desactívala.`)
      return
    }
    update[f.key] = cents
  }
  feeSaving.value = true
  const { error } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  feeSaving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  // The reschedule dialog reads this one from the store, not the database.
  store.schedulingPolicyFeeCents = update.scheduling_policy_fee_cents ?? null
  showToast(t('Saved', 'Guardado'))
}

function usesLabel(id: string) {
  const n = uses.value[id]
  if (n === undefined) return ''
  if (n === 0) return t('Not used yet', 'Aún sin usar')
  return n === 1 ? t('Used once', 'Usado 1 vez') : t(`Used ${n} times`, `Usado ${n} veces`)
}

// --- reasons ---

const newReason = ref('')
const adding = ref(false)
const reasonError = ref('')

async function addReason() {
  reasonError.value = ''
  const name = newReason.value.trim()
  if (!name) return
  if (reasons.value.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    reasonError.value = t('There is already a reason with that name.', 'Ya hay un motivo con ese nombre.')
    return
  }
  adding.value = true
  const { error } = await supabase.from('reschedule_reasons').insert({ account_id: store.accountId!, name })
  adding.value = false
  if (error) {
    reasonError.value = error.message
    return
  }
  newReason.value = ''
  await load()
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')
function startRename(r: Tables<'reschedule_reasons'>) {
  renamingId.value = r.id
  renameValue.value = r.name
}
async function saveRename(r: Tables<'reschedule_reasons'>) {
  const name = renameValue.value.trim()
  if (!name || name === r.name) {
    renamingId.value = null
    return
  }
  const { error } = await supabase.from('reschedule_reasons').update({ name }).eq('id', r.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  r.name = name
  renamingId.value = null
}

// appointment_reschedules.reason_id is `on delete set null`: the moves stay,
// without a reason. Said in the dialog before it happens.
const deleting = ref<Tables<'reschedule_reasons'> | null>(null)
async function confirmDelete() {
  if (!deleting.value) return
  const { error } = await supabase.from('reschedule_reasons').delete().eq('id', deleting.value.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  deleting.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Scheduling Policies', 'Políticas de programación')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="policies-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What a patient can be charged when an appointment changes, and the reasons staff give when they move one.', 'Lo que se puede cobrar a un paciente cuando cambia una cita, y los motivos que da el personal al moverla.') }}
          </p>

          <section aria-labelledby="h-fees" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-2 pt-4">
              <h2 id="h-fees" class="text-[16px] font-bold text-ink-900">{{ t('Fees', 'Tarifas') }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('Offered, never charged automatically: staff choose each time whether to apply it.', 'Se ofrecen, nunca se cobran solas: el personal decide cada vez si aplicarlas.') }}</p>
            </div>
            <template v-if="loading">
              <div v-for="i in 3" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-5">
                <UiSkeleton class="h-[26px] w-11 rounded-pill" />
                <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
              </div>
            </template>
            <div v-for="f in FEES" v-else :key="f.key" data-cy="fee-row" :data-fee="f.key" class="flex min-h-[76px] flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
              <button
                type="button"
                role="switch"
                data-cy="fee-switch"
                :aria-checked="feeOn[f.key]"
                :aria-labelledby="`fee-${f.key}`"
                class="relative h-[26px] w-11 shrink-0 rounded-full"
                :class="feeOn[f.key] ? 'bg-brand' : 'bg-line-control'"
                @click="feeOn[f.key] = !feeOn[f.key]"
              >
                <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="feeOn[f.key] ? 'left-[21px]' : 'left-[3px]'" />
              </button>
              <div class="flex min-w-[200px] flex-1 flex-col gap-0.5">
                <strong :id="`fee-${f.key}`" class="text-[14.5px] text-ink-900">{{ f.title }}</strong>
                <span class="text-[13px] leading-snug text-ink-500">{{ f.where }}</span>
              </div>
              <label v-if="feeOn[f.key]" class="flex items-center gap-2 text-[14px] text-ink-500">
                <input v-model="feeAmount[f.key]" data-cy="fee-amount" type="text" inputmode="decimal" placeholder="25,00" :aria-label="t(`${f.title} fee (€)`, `Tarifa de ${f.title.toLowerCase()} (€)`)" :class="[inputClass, 'w-24 text-right']" />
                €
              </label>
              <span v-else class="text-[13px] text-ink-muted">{{ t('Not offered', 'No se ofrece') }}</span>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-subtle px-[18px] py-3">
              <p v-if="feeError" class="flex-1 text-[12.5px] font-semibold text-danger-text" data-cy="fee-error">{{ feeError }}</p>
              <UiBtn variant="primary" data-cy="fees-save" :disabled="feeSaving || loading" @click="saveFees">{{ feeSaving ? t('Saving…', 'Guardando…') : t('Save fees', 'Guardar tarifas') }}</UiBtn>
            </div>
          </section>

          <section aria-labelledby="h-reasons" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <div class="flex-1">
                <h2 id="h-reasons" class="text-[16px] font-bold text-ink-900">{{ t(`Reschedule reasons · ${reasons.length}`, `Motivos de reprogramación · ${reasons.length}`) }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('Picked when an appointment is dragged to a new time.', 'Se eligen al arrastrar una cita a otra hora.') }}</p>
              </div>
            </div>
            <p v-if="!loading && reasons.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No reasons yet. Add the first one below.', 'Aún no hay motivos. Añade el primero abajo.') }}
            </p>
            <div v-for="r in reasons" :key="r.id" data-cy="reason-row" class="flex min-h-[56px] items-center gap-3.5 border-t border-line-row py-1.5 pl-[18px] pr-3">
              <form v-if="renamingId === r.id" class="flex min-w-0 flex-1 items-center gap-2" @submit.prevent="saveRename(r)">
                <input v-model="renameValue" data-cy="reason-rename" type="text" :aria-label="t('Reason', 'Motivo')" :class="[inputClass, 'min-w-0 flex-1']" @keydown.esc="renamingId = null" />
                <UiBtn variant="ghost" @click="renamingId = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <UiBtn variant="primary" type="submit">{{ t('Save', 'Guardar') }}</UiBtn>
              </form>
              <template v-else>
                <strong class="min-w-0 flex-1 truncate text-[15px] text-ink-900" data-cy="reason-name">{{ r.name }}</strong>
                <span class="text-[13px] text-ink-500" data-cy="reason-uses">{{ usesLabel(r.id) }}</span>
                <button type="button" :class="iconBtn" :aria-label="t(`Rename ${r.name}`, `Renombrar ${r.name}`)" @click="startRename(r)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
                <button type="button" data-cy="reason-delete" :class="iconBtn" :aria-label="t(`Delete ${r.name}`, `Eliminar ${r.name}`)" @click="deleting = r">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </template>
            </div>
            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3" @submit.prevent="addReason">
              <input
                v-model="newReason"
                data-cy="reason-new-name"
                type="text"
                :placeholder="t('Add a reason, e.g. Practitioner off sick', 'Añade un motivo, ej. Profesional de baja')"
                :aria-label="t('New reason', 'Nuevo motivo')"
                :class="[inputClass, 'min-w-0 flex-1']"
              />
              <UiBtn type="submit" data-cy="reason-new-save" :disabled="adding || !newReason.trim()">{{ adding ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="reasonError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ reasonError }}</p>
            </form>
          </section>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.name}”?`, `¿Eliminar «${deleting.name}»?`)"
      :confirm-label="t('Delete reason', 'Eliminar motivo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Appointments already moved with it keep their move; they just show no reason. It stops being offered from now on.', 'Las citas ya movidas con este motivo conservan el cambio; simplemente quedan sin motivo. Deja de ofrecerse a partir de ahora.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
