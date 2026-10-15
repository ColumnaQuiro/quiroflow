<script setup lang="ts">
import { carePlanCadenceLabel } from '../../utils/carePlanCadence'
import { DISCHARGE_RECALL_DAYS, renewalDue, renewalPreset, type RenewalKind } from '../../utils/planRenewal'

// "Revisión": the patient's care plan is ending (utils/planRenewal.ts), so
// the visit carries the review -- in one place, how it went (pain at the start
// and now, visits attended and missed, the report) and what comes next: the
// same plan again, maintenance, or discharge. On My Day and in the staff
// app's visit screen; renders nothing when the plan is not ending.
//
//   - A new plan starts the day after the current plan's last booked visit
//     (or today), editable.
//   - "…and add the bono" also opens that bono for the patient, owed in full
//     -- the desk takes the money in Dinero, with its factura, as with any
//     bono sold there.
//   - Discharge starts no plan and brings them back into Recalls in three
//     months (recall_snoozed_until).
//
// Shared by web and app, so the account and the permissions come in as props.
const props = defineProps<{ patientId: string; accountId: string; teamMemberId: string | null; editable: boolean; canSellBono: boolean; reportTo?: string | null }>()
const emit = defineEmits<{ renewed: [] }>()
const t = useT()
const supabase = useSupabaseClient()

interface Plan { id: string; name: string; frequency_value: number; frequency_unit: string; visits_per_period: number | null; total_visits: number; started_at: string }
const plan = ref<Plan | null>(null)
const done = ref(0)
const missed = ref(0)
const lastBooked = ref<string | null>(null)
const pain = ref<{ first: number | null; latest: number | null }>({ first: null, latest: null })
const packages = ref<{ id: string; name: string; price_cents: number; session_count: number }[]>([])
const kind = ref<RenewalKind>('maintenance')
const name = ref('')
const startOn = ref('')
const packageId = ref('')
const busy = ref(false)
const error = ref('')
const finished = ref('')
const loaded = ref(false)

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function load() {
  const { data: p } = await supabase.from('care_plans').select('id, name, frequency_value, frequency_unit, visits_per_period, total_visits, started_at').eq('patient_id', props.patientId).order('started_at', { ascending: false }).limit(1).maybeSingle()
  plan.value = (p as Plan | null) ?? null
  if (plan.value) {
    const { data: appts } = await supabase.from('appointments').select('id, starts_at, status').eq('patient_id', props.patientId).is('deleted_at', null).gte('starts_at', plan.value.started_at).order('starts_at')
    const list = (appts as { id: string; starts_at: string; status: string }[] | null) ?? []
    done.value = list.filter((a) => a.status === 'completed').length
    missed.value = list.filter((a) => a.status === 'no_show').length
    const booked = list.filter((a) => a.status === 'booked' || a.status === 'completed')
    lastBooked.value = booked.length ? booked[booked.length - 1]!.starts_at : null
    const ids = list.map((a) => a.id)
    if (ids.length) {
      const { data: scores } = await supabase.from('visit_pain_scores').select('appointment_id, practitioner_score, patient_score').in('appointment_id', ids)
      const byAppt = new Map(((scores as { appointment_id: string; practitioner_score: number | null; patient_score: number | null }[] | null) ?? []).map((s) => [s.appointment_id, s.practitioner_score ?? s.patient_score]))
      const scored = list.map((a) => byAppt.get(a.id)).filter((v): v is number => v !== null && v !== undefined)
      pain.value = { first: scored[0] ?? null, latest: scored[scored.length - 1] ?? null }
    }
    if (props.canSellBono) {
      const { data: pk } = await supabase.from('packages').select('id, name, price_cents, session_count').order('name')
      packages.value = (pk as typeof packages.value | null) ?? []
    }
    const after = lastBooked.value ? new Date(lastBooked.value) : new Date()
    after.setDate(after.getDate() + 1)
    startOn.value = iso(after < new Date() ? new Date() : after)
    choose('maintenance')
  }
  loaded.value = true
}
watch(() => props.patientId, load, { immediate: true })

const due = computed(() => !!plan.value && renewalDue(plan.value, done.value))
const remaining = computed(() => (plan.value ? Math.max(0, plan.value.total_visits - done.value) : 0))
const preset = computed(() => (plan.value ? renewalPreset(kind.value, plan.value) : null))
function choose(k: RenewalKind) {
  kind.value = k
  if (!plan.value) return
  name.value = k === 'maintenance' ? t('Maintenance', 'Mantenimiento') : k === 'same' ? plan.value.name : ''
  packageId.value = ''
}
const KIND_LABEL = computed<Record<RenewalKind, string>>(() => ({ maintenance: t('Maintenance', 'Mantenimiento'), same: t('Same again', 'Seguir igual'), discharge: t('Discharge', 'Alta') }))
const describe = (k: RenewalKind) => {
  if (!plan.value) return ''
  const p = renewalPreset(k, plan.value)
  return k === 'discharge' ? t('Close the plan · back in recalls in 3 months', 'Cerrar el plan · recordatorio a los 3 meses') : `${carePlanCadenceLabel(p, t)} · ${t(`${p.total_visits} visits`, `${p.total_visits} visitas`)}`
}

async function renew(withBono: boolean) {
  if (!plan.value || !preset.value || !props.editable) return
  busy.value = true
  error.value = ''
  if (kind.value === 'discharge') {
    const until = new Date()
    until.setDate(until.getDate() + DISCHARGE_RECALL_DAYS)
    const { data, error: e } = await supabase.from('patients').update({ recall_snoozed_until: iso(until), recall_status: 'active' } as never).eq('id', props.patientId).select('id')
    busy.value = false
    if (e || !data?.length) {
      error.value = t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
      return
    }
    finished.value = t(`Discharged: back in Recalls from ${until.toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long' })}.`, `Alta: vuelve a Recordatorios el ${until.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`)
    emit('renewed')
    return
  }
  let purchaseId: string | null = null
  const pkg = packages.value.find((x) => x.id === packageId.value)
  if (withBono && pkg) {
    const { data: purchase, error: e } = await supabase
      .from('package_purchases')
      .insert({ account_id: props.accountId, patient_id: props.patientId, package_id: pkg.id, package_name: pkg.name, sessions_total: pkg.session_count, price_cents: pkg.price_cents, invoice_id: null, owed_cents: pkg.price_cents, created_by: props.teamMemberId } as never)
      .select('id')
      .single()
    if (e || !purchase) {
      busy.value = false
      error.value = t("Couldn't add the bono. The plan was not created.", 'No se ha podido añadir el bono. No se ha creado el plan.')
      return
    }
    purchaseId = (purchase as { id: string }).id
  }
  const { error: e } = await supabase.from('care_plans').insert({
    account_id: props.accountId,
    patient_id: props.patientId,
    name: name.value.trim() || KIND_LABEL.value[kind.value],
    frequency_value: preset.value.frequency_value,
    frequency_unit: preset.value.frequency_unit,
    visits_per_period: preset.value.visits_per_period ?? 1,
    total_visits: preset.value.total_visits,
    started_at: startOn.value,
    payment_kind: purchaseId ? 'bono' : 'per_visit',
    package_purchase_id: purchaseId,
    created_by: props.teamMemberId,
  } as never)
  busy.value = false
  if (e) {
    error.value = t("Couldn't create the plan. Try again.", 'No se ha podido crear el plan. Inténtalo de nuevo.')
    return
  }
  finished.value = purchaseId
    ? t(`${name.value || KIND_LABEL.value[kind.value]} created, with ${pkg!.name} to collect at the desk.`, `${name.value || KIND_LABEL.value[kind.value]} creado, con ${pkg!.name} pendiente de cobro en recepción.`)
    : t(`${name.value || KIND_LABEL.value[kind.value]} created.`, `${name.value || KIND_LABEL.value[kind.value]} creado.`)
  emit('renewed')
}
const field = 'h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900'
</script>

<template>
  <section v-if="loaded && plan && (due || finished)" class="rounded-card border border-warning-border bg-warning-bg2 p-4" data-cy="plan-renewal">
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex h-6 items-center rounded-pill bg-warning-bg px-2.5 text-[12px] font-semibold text-warning-text">{{ t('Review', 'Revisión') }}</span>
      <h2 class="text-[14.5px] font-semibold text-ink-900">
        {{ remaining === 0 ? t(`${plan.name} is complete: what comes next?`, `${plan.name} ha terminado: ¿qué sigue?`) : t(`${plan.name} ends in ${remaining} ${remaining === 1 ? 'visit' : 'visits'}: what comes next?`, `${plan.name} termina en ${remaining} ${remaining === 1 ? 'visita' : 'visitas'}: ¿qué sigue?`) }}
      </h2>
    </div>

    <p v-if="finished" class="mt-3 text-[13.5px] font-medium text-success-text" role="status" data-cy="plan-renewal-done">{{ finished }}</p>
    <template v-else>
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-ctl border border-line bg-surface p-2.5"><p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Pain', 'Dolor') }}</p><p class="mt-0.5 font-mono text-[18px] font-semibold text-ink-900" data-cy="plan-renewal-pain">{{ pain.first !== null && pain.latest !== null ? `${pain.first} → ${pain.latest}` : '—' }}</p></div>
        <div class="rounded-ctl border border-line bg-surface p-2.5"><p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Visits', 'Visitas') }}</p><p class="mt-0.5 font-mono text-[18px] font-semibold text-ink-900" data-cy="plan-renewal-visits">{{ done }}/{{ plan.total_visits }}</p></div>
        <div class="rounded-ctl border border-line bg-surface p-2.5"><p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Missed', 'Perdidas') }}</p><p class="mt-0.5 font-mono text-[18px] font-semibold text-ink-900">{{ missed }}</p></div>
        <div class="flex items-center rounded-ctl border border-line bg-surface p-2.5">
          <NuxtLink v-if="reportTo" :to="reportTo" class="text-[12.5px] font-semibold text-brand-text" data-cy="plan-renewal-report">{{ t('Progress report', 'Informe de revisión') }} →</NuxtLink>
        </div>
      </div>

      <template v-if="editable">
        <p class="mt-4 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Next', 'Propuesta') }}</p>
        <div class="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" :aria-label="t('What comes next', 'Qué sigue')">
          <button
            v-for="k in (['maintenance', 'same', 'discharge'] as const)"
            :key="k"
            type="button"
            role="radio"
            :aria-checked="kind === k"
            class="flex flex-col items-start gap-0.5 rounded-ctl border bg-surface p-2.5 text-left"
            :class="kind === k ? 'border-brand ring-2 ring-brand/20' : 'border-line-control'"
            :data-cy="`plan-renewal-${k}`"
            @click="choose(k)"
          >
            <span class="text-[13.5px] font-semibold text-ink-900">{{ KIND_LABEL[k] }}</span>
            <span class="text-[12px] text-ink-muted">{{ describe(k) }}</span>
          </button>
        </div>

        <div v-if="kind !== 'discharge'" class="mt-3 flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Plan name', 'Nombre del plan') }}<input v-model="name" :class="field" class="w-52" data-cy="plan-renewal-name" /></label>
          <label class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Starts', 'Empieza') }}<input v-model="startOn" type="date" :class="field" data-cy="plan-renewal-start" /></label>
          <label v-if="canSellBono && packages.length" class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Bono', 'Bono') }}
            <select v-model="packageId" :class="field" class="w-56" data-cy="plan-renewal-bono">
              <option value="">{{ t('None', 'Ninguno') }}</option>
              <option v-for="p in packages" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
        </div>

        <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <template v-if="kind === 'discharge'">
            <UiBtn variant="primary" size="sm" :disabled="busy" data-cy="plan-renewal-confirm-discharge" @click="renew(false)">{{ t('Discharge', 'Dar el alta') }}</UiBtn>
          </template>
          <template v-else>
            <UiBtn variant="secondary" size="sm" :disabled="busy" data-cy="plan-renewal-create" @click="renew(false)">{{ t('Just create the plan', 'Solo crear el plan') }}</UiBtn>
            <UiBtn v-if="canSellBono && packageId" variant="primary" size="sm" :disabled="busy" data-cy="plan-renewal-create-bono" @click="renew(true)">{{ t('Create plan and add the bono', 'Crear plan y añadir bono') }}</UiBtn>
          </template>
        </div>
        <p v-if="kind !== 'discharge' && packageId" class="mt-1.5 text-right text-[12px] text-ink-muted">{{ t('The bono is owed in full; the desk takes the money in Money, with its factura.', 'El bono queda pendiente; recepción lo cobra en Dinero, con su factura.') }}</p>
      </template>
    </template>
  </section>
</template>
