<script setup lang="ts">
// A care plan from the record: "Añadir plan", or "Editar" the current one --
// the web's EditCarePlanModal (behind PhaseStats on the Clinical tab), with
// its write. Like the web, saving INSERTS a plan rather than updating the
// current one: progress made under the old cadence stays counted against it,
// and the edited plan starts a fresh phase from its start date (which is what
// the record, the visit screen and care_plan_continuity_alerts count from).
// Who may: anyone who can see the patient, as on the web; RLS ("staff manage
// care_plans") scopes it the way it scopes the patient.
const props = defineProps<{
  patientId: string
  plan?: { name: string; frequency_value: number; frequency_unit: string; total_visits: number; started_at: string } | null
  /** The clinic's date today, the default start. */
  today: string
}>()
const emit = defineEmits<{ saved: []; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { context } = usePractitionerContext()

const name = ref(props.plan?.name ?? t('Care Plan', 'Plan de tratamiento'))
const every = ref(props.plan?.frequency_value ?? 1)
const unit = ref<'week' | 'month'>(props.plan?.frequency_unit === 'month' ? 'month' : 'week')
const total = ref(props.plan?.total_visits ?? 10)
// As the web: an edit keeps the plan's own start unless it is changed.
const startedAt = ref(props.plan?.started_at?.slice(0, 10) ?? props.today)
const saving = ref(false)
const error = ref('')

// The cadences a clinic sets most, one tap each; the steppers do the rest.
const PRESETS = computed(() => [
  { every: 1, unit: 'week' as const, label: t('Weekly', 'Semanal') },
  { every: 2, unit: 'week' as const, label: t('Every 2 weeks', 'Cada 2 semanas') },
  { every: 3, unit: 'week' as const, label: t('Every 3 weeks', 'Cada 3 semanas') },
  { every: 1, unit: 'month' as const, label: t('Monthly', 'Mensual') },
])
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo))

async function save() {
  if (saving.value || !context.value) return
  error.value = ''
  if (!startedAt.value) {
    error.value = t('Choose a start date.', 'Elige la fecha de inicio.')
    return
  }
  saving.value = true
  const { error: e } = await supabase.from('care_plans').insert({
    account_id: context.value.accountId,
    patient_id: props.patientId,
    name: name.value.trim() || t('Care Plan', 'Plan de tratamiento'),
    frequency_value: clamp(every.value, 1, 52),
    frequency_unit: unit.value,
    total_visits: clamp(total.value, 1, 200),
    started_at: startedAt.value,
    created_by: context.value.teamMemberId,
  } as never)
  saving.value = false
  if (e) {
    error.value = e.message
    return
  }
  emit('saved')
}
const field = 'h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none'
const stepBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control text-[18px] font-semibold text-ink-700 disabled:opacity-40'
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="care-plan-sheet" @click.self="emit('close')">
    <form
      class="flex max-h-[92%] w-full flex-col gap-3.5 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[460px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="plan ? t('Edit plan', 'Editar plan') : t('New care plan', 'Nuevo plan de tratamiento')"
      @submit.prevent="save"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ plan ? t('Edit plan', 'Editar plan') : t('New care plan', 'Nuevo plan de tratamiento') }}</p>

      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Name', 'Nombre') }}
        <input v-model="name" type="text" :class="field" data-cy="plan-name" />
      </label>

      <div class="flex flex-col gap-1.5">
        <p class="text-[12.5px] font-medium text-ink-muted">{{ t('How often', 'Frecuencia') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in PRESETS"
            :key="p.label"
            type="button"
            class="h-9 rounded-full border px-3 text-[13px] font-medium"
            :class="every === p.every && unit === p.unit ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'"
            :aria-pressed="every === p.every && unit === p.unit"
            @click="every = p.every; unit = p.unit"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[14px] text-ink-700">{{ t('1 visit every', '1 visita cada') }}</span>
          <button type="button" :class="stepBtn" :disabled="every <= 1" :aria-label="t('Less', 'Menos')" @click="every = clamp(every - 1, 1, 52)">−</button>
          <span class="w-8 text-center text-[16px] font-semibold tabular-nums text-ink-900" data-cy="plan-every">{{ every }}</span>
          <button type="button" :class="stepBtn" :aria-label="t('More', 'Más')" @click="every = clamp(every + 1, 1, 52)">+</button>
          <select v-model="unit" class="h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="plan-unit">
            <option value="week">{{ every === 1 ? t('week', 'semana') : t('weeks', 'semanas') }}</option>
            <option value="month">{{ every === 1 ? t('month', 'mes') : t('months', 'meses') }}</option>
          </select>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-[14px] text-ink-700">{{ t('Visits in the plan', 'Visitas en el plan') }}</span>
        <div class="flex items-center gap-2">
          <button type="button" :class="stepBtn" :disabled="total <= 1" :aria-label="t('Fewer visits', 'Menos visitas')" @click="total = clamp(total - 1, 1, 200)">−</button>
          <input v-model.number="total" type="number" inputmode="numeric" min="1" max="200" class="h-11 w-16 rounded-ctl border border-line-control bg-surface text-center text-[16px] font-semibold tabular-nums text-ink-900" :aria-label="t('Visits in the plan', 'Visitas en el plan')" data-cy="plan-total" />
          <button type="button" :class="stepBtn" :aria-label="t('More visits', 'Más visitas')" @click="total = clamp(total + 1, 1, 200)">+</button>
        </div>
      </div>

      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Starts', 'Empieza') }}
        <input v-model="startedAt" type="date" :class="field" data-cy="plan-start" />
      </label>

      <p v-if="plan" class="text-[12px] leading-snug text-ink-muted">
        {{ t('Saving keeps the current plan in the history and starts this one; progress counts from its start date.', 'Al guardar, el plan actual queda en el historial y empieza este; el progreso se cuenta desde su fecha de inicio.') }}
      </p>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="saving" data-cy="plan-save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
      </button>
      <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </form>
  </div>
</template>
