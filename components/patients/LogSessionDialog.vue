<script setup lang="ts">
import { formatEur, formatTime, formatWeekdayDate } from '~/utils/billing'
import { localDateStr, type LogSessionChoice, type UnloggedVisit } from '~/utils/unloggedVisits'

// Logging a bono session: which visit it pays for, and what that does to the
// bono, before anything is written.
//
// This replaces two controls -- "Log session", one click on today behind a
// browser confirm(), and "Another date", which picked a day but could not see
// the calendar and so always invented a visit. Reception had to know which of
// the two to press, and the second one duplicated real appointments.
//
// The choice is now a list of the patient's visits that nothing has paid for
// yet (loadUnloggedVisits), most recent first, with "not on the calendar" as
// the last resort. When the only candidate is today's visit it is picked
// already, so the everyday case is still open + confirm. When there are older
// ones and nothing today, nothing is picked: guessing a day here is exactly
// how a session ends up on the wrong visit.

const props = defineProps<{
  bonoName: string
  sessionsUsed: number
  sessionsTotal: number
  perSessionCents: number
  visits: UnloggedVisit[]
  loading: boolean
  busy: boolean
}>()
const emit = defineEmits<{ confirm: [choice: LogSessionChoice]; cancel: [] }>()
const t = useT()

const today = localDateStr()
const NEW = '__new__'

const isToday = (v: UnloggedVisit) => localDateStr(new Date(v.starts_at)) === today
const todaysVisit = computed(() => props.visits.find(isToday) ?? null)

const selected = ref<string | null>(null)
const newDate = ref(today)

// Re-evaluated once the list arrives, not only on mount: the parent opens the
// dialog straight away and loads the visits into it.
watch(
  () => [props.loading, props.visits] as const,
  ([loading]) => {
    if (loading || selected.value !== null) return
    if (todaysVisit.value) selected.value = todaysVisit.value.id
    else if (props.visits.length === 0) selected.value = NEW
  },
  { immediate: true },
)

const chosenVisit = computed(() => props.visits.find((v) => v.id === selected.value) ?? null)
const canConfirm = computed(() => !props.loading && (!!chosenVisit.value || (selected.value === NEW && !!newDate.value && newDate.value <= today)))

const leftAfter = computed(() => props.sessionsTotal - props.sessionsUsed - 1)

function visitLabel(v: UnloggedVisit) {
  return [formatWeekdayDate(v.starts_at), formatTime(v.starts_at), v.typeName, v.practitionerName].filter(Boolean).join(' · ')
}

function confirm() {
  if (!canConfirm.value) return
  if (chosenVisit.value) emit('confirm', { kind: 'visit', visit: chosenVisit.value })
  else emit('confirm', { kind: 'new', dateStr: newDate.value })
}
</script>

<template>
  <UiConfirmDialog
    :title="`${t('Log a session', 'Registrar una sesión')} · ${bonoName}`"
    :confirm-label="busy ? t('Logging…', 'Registrando…') : t('Log session', 'Registrar sesión')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    :disabled="!canConfirm"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <div data-cy="log-session-dialog" class="flex flex-col gap-3 text-[13px] text-ink-700">
      <p class="font-semibold text-ink-900">{{ t('Which visit is this session for?', '¿A qué visita corresponde esta sesión?') }}</p>

      <p v-if="loading" class="text-ink-muted">{{ t('Looking for visits…', 'Buscando visitas…') }}</p>

      <template v-else>
        <p v-if="visits.length > 1 && !todaysVisit" class="rounded-ctl bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text">
          {{ t(`${visits.length} visits have nothing paying for them yet. Pick the one this session is for.`, `${visits.length} visitas aún no tienen nada que las pague. Elige a cuál corresponde esta sesión.`) }}
        </p>

        <label
          v-for="v in visits"
          :key="v.id"
          data-cy="log-session-visit"
          class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-2.5"
          :class="selected === v.id ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'"
        >
          <input v-model="selected" type="radio" name="log-session-visit" :value="v.id" class="mt-0.5" />
          <span class="min-w-0">
            <span class="block font-medium text-ink-900">
              {{ visitLabel(v) }}
              <UiPill v-if="isToday(v)" tone="brand" class="ml-1 align-middle">{{ t('Today', 'Hoy') }}</UiPill>
            </span>
            <span v-if="v.unpaidInvoice" class="mt-0.5 block text-[12px] text-ink-muted2">
              {{
                t(
                  `${v.unpaidInvoice.invoice_number ?? 'Its unpaid receipt'} (${formatEur(v.unpaidInvoice.total_cents)}, unpaid) will be voided -- the bono pays for this visit.`,
                  `${v.unpaidInvoice.invoice_number ?? 'Su recibo pendiente'} (${formatEur(v.unpaidInvoice.total_cents)}, sin pagar) se anulará: el bono paga esta visita.`,
                )
              }}
            </span>
          </span>
        </label>

        <label
          data-cy="log-session-new"
          class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-2.5"
          :class="selected === NEW ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'"
        >
          <input v-model="selected" type="radio" name="log-session-visit" :value="NEW" class="mt-0.5" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-ink-900">{{ t('A visit that is not on the calendar', 'Una visita que no está en el calendario') }}</span>
            <span class="mt-0.5 block text-[12px] text-ink-muted2">
              {{ t('A visit is recorded on this day for the patient’s practitioner.', 'Se registra una visita en este día con el profesional del paciente.') }}
            </span>
            <input
              v-if="selected === NEW"
              v-model="newDate"
              data-cy="log-session-date"
              type="date"
              :max="today"
              class="mt-2 rounded-ctlSm border border-line-control bg-surface px-2 py-1 text-[13px]"
            />
          </span>
        </label>
      </template>

      <p data-cy="log-session-summary" class="rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-600">
        {{
          t(
            `Uses 1 session: ${leftAfter} of ${sessionsTotal} left afterwards. The visit is charged ${formatEur(perSessionCents)}, the bono's rate per session, and settled from what the patient has paid for the bono.`,
            `Consume 1 sesión: quedarán ${leftAfter} de ${sessionsTotal}. La visita se carga a ${formatEur(perSessionCents)}, el precio por sesión del bono, y se salda con lo que el paciente ha pagado por el bono.`,
          )
        }}
      </p>
    </div>
  </UiConfirmDialog>
</template>
