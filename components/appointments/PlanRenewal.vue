<script setup lang="ts">
import { carePlanCadenceLabel } from '../../utils/carePlanCadence'
import { dischargeRecallDate, MAINTENANCE_COLUMNS, maintenanceConfig, maintenancePreset, previousCadence, renewalDue, type MaintenanceConfig, type MaintenanceRow, type PlanShape, type RenewalKind } from '../../utils/planRenewal'
import { readInstallmentOptions } from '../../utils/bonoInstallments'
import { formatEur } from '../../utils/billing'

// "Revisión": the patient's care plan is ending (utils/planRenewal.ts), so
// the visit carries the review -- in one place, how it went (pain at the start
// and now, visits attended and missed, the report) and what comes next: keep
// coming, or discharge. On My Day and in the staff app's visit screen;
// renders nothing when the plan is not ending.
//
//   - "Keep coming" is prefilled with the clinic's maintenance (Settings >
//     Care plans): its cadence and its length, no end by default. Both can be
//     changed in place, and "volver a eso" puts back the cadence the patient
//     had.
//   - A new plan starts the day after the current plan's last booked visit
//     (or today), editable.
//   - The clinic's membership, when it has one, is offered beside it: ticked,
//     the patient is enrolled (or their active one reused) and the plan is
//     paid by it. Collected as any membership is, in Dinero.
//   - "…and add the bono" also opens that bono for the patient, owed in full
//     -- the desk takes the money in Dinero, with its factura, as with any
//     bono sold there. A bono with split options (Settings > Bonos) is opened
//     under the one chosen here, at that option's price.
//   - The habits pack, when the clinic has one for this choice, is sent
//     through api/learn/send, leaving out readings the patient already has.
//   - Discharge starts no plan and brings them back into Recalls after the
//     clinic's months (recall_snoozed_until).
//
// Shared by web and app, so the account and the permissions come in as props.
const props = defineProps<{ patientId: string; accountId: string; teamMemberId: string | null; editable: boolean; canSellBono: boolean; reportTo?: string | null }>()
const emit = defineEmits<{ renewed: [] }>()
const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { fire } = useAutomations()

interface Plan { id: string; name: string; frequency_value: number; frequency_unit: string; visits_per_period: number | null; total_visits: number | null; started_at: string; next_phases?: unknown }
interface Membership { id: string; name: string; price_cents: number; billing_interval: string | null; billing_interval_count: number | null }
const plan = ref<Plan | null>(null)
const done = ref(0)
const missed = ref(0)
const lastBooked = ref<string | null>(null)
const pain = ref<{ first: number | null; latest: number | null }>({ first: null, latest: null })
const packages = ref<{ id: string; name: string; price_cents: number; session_count: number; installment_options: unknown }[]>([])
const config = ref<MaintenanceConfig>(maintenanceConfig(null))
const membership = ref<Membership | null>(null)
const activeMembershipId = ref<string | null>(null)
const habitArticles = ref<{ id: string; title: string; video_url: string | null; had: boolean }[]>([])
const kind = ref<RenewalKind>('continue')
const shape = ref<PlanShape>(maintenancePreset(config.value))
const name = ref('')
const startOn = ref('')
const packageId = ref('')
const installments = ref(1)
const withMembership = ref(true)
const withHabits = ref(true)
const packageOptions = computed(() => readInstallmentOptions(packages.value.find((x) => x.id === packageId.value)?.installment_options))
watch(packageId, () => {
  installments.value = 1
})
const busy = ref(false)
const error = ref('')
const finished = ref('')
const loaded = ref(false)

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function load() {
  const { data: p } = await supabase.from('care_plans').select('id, name, frequency_value, frequency_unit, visits_per_period, total_visits, started_at, next_phases').eq('patient_id', props.patientId).order('started_at', { ascending: false }).limit(1).maybeSingle()
  plan.value = (p as Plan | null) ?? null
  if (plan.value) {
    const { data: appts } = await supabase.from('appointments').select('id, starts_at, status').eq('patient_id', props.patientId).is('deleted_at', null).gte('starts_at', plan.value.started_at).order('starts_at')
    const list = (appts as { id: string; starts_at: string; status: string }[] | null) ?? []
    done.value = list.filter((a) => a.status === 'completed').length
    missed.value = list.filter((a) => a.status === 'no_show').length
    const booked = list.filter((a) => a.status === 'booked' || a.status === 'completed')
    lastBooked.value = booked.length ? booked[booked.length - 1]!.starts_at : null
    // Nothing more to read for a plan that is not ending.
    if (!renewalDue(plan.value, done.value)) {
      loaded.value = true
      return
    }
    const ids = list.map((a) => a.id)
    const [{ data: scores }, { data: account }] = await Promise.all([
      ids.length ? supabase.from('visit_pain_scores').select('appointment_id, practitioner_score, patient_score').in('appointment_id', ids) : Promise.resolve({ data: [] }),
      supabase.from('accounts').select(MAINTENANCE_COLUMNS).eq('id', props.accountId).maybeSingle(),
    ])
    const byAppt = new Map(((scores as { appointment_id: string; practitioner_score: number | null; patient_score: number | null }[] | null) ?? []).map((s) => [s.appointment_id, s.practitioner_score ?? s.patient_score]))
    const scored = list.map((a) => byAppt.get(a.id)).filter((v): v is number => v !== null && v !== undefined)
    pain.value = { first: scored[0] ?? null, latest: scored[scored.length - 1] ?? null }
    config.value = maintenanceConfig(account as MaintenanceRow | null)
    const habitIds = config.value.habitsArticleIds
    const [pk, mem, active, arts, sentBefore] = await Promise.all([
      props.canSellBono ? supabase.from('packages').select('id, name, price_cents, session_count, installment_options').order('name') : Promise.resolve({ data: [] }),
      props.canSellBono && config.value.membershipId ? supabase.from('memberships').select('id, name, price_cents, billing_interval, billing_interval_count').eq('id', config.value.membershipId).maybeSingle() : Promise.resolve({ data: null }),
      props.canSellBono && config.value.membershipId ? supabase.from('patient_memberships').select('id').eq('patient_id', props.patientId).eq('membership_id', config.value.membershipId).eq('status', 'active').limit(1) : Promise.resolve({ data: [] }),
      habitIds.length ? supabase.from('learn_articles').select('id, title, video_url').in('id', habitIds).is('archived_at', null) : Promise.resolve({ data: [] }),
      habitIds.length ? supabase.from('learn_sends').select('article_id').eq('patient_id', props.patientId).in('article_id', habitIds) : Promise.resolve({ data: [] }),
    ])
    packages.value = (pk.data as typeof packages.value | null) ?? []
    // A membership deleted since it was chosen in Settings is simply not offered.
    membership.value = (mem.data as Membership | null) ?? null
    activeMembershipId.value = ((active.data as { id: string }[] | null) ?? [])[0]?.id ?? null
    const had = new Set(((sentBefore.data as { article_id: string }[] | null) ?? []).map((s) => s.article_id))
    const found = (arts.data as { id: string; title: string; video_url: string | null }[] | null) ?? []
    habitArticles.value = habitIds.map((id) => found.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => ({ ...a, had: had.has(a.id) }))
    const after = lastBooked.value ? new Date(lastBooked.value) : new Date()
    after.setDate(after.getDate() + 1)
    startOn.value = iso(after < new Date() ? new Date() : after)
    reset('continue')
  }
  loaded.value = true
}
watch(() => props.patientId, load, { immediate: true })

const due = computed(() => !!plan.value && renewalDue(plan.value, done.value))
const remaining = computed(() => (plan.value?.total_visits ? Math.max(0, plan.value.total_visits - done.value) : 0))
const maintenanceName = computed(() => t('Maintenance', 'Mantenimiento'))
function reset(k: RenewalKind) {
  kind.value = k
  shape.value = maintenancePreset(config.value)
  name.value = maintenanceName.value
  packageId.value = ''
}
// Choosing again what is already chosen keeps what was edited in it.
function choose(k: RenewalKind) {
  if (k !== kind.value) reset(k)
}

// "volver a eso": the cadence the patient had, at the length now chosen; and
// back again to the clinic's maintenance.
const previous = computed(() => (plan.value ? previousCadence(plan.value, shape.value.total_visits) : null))
const sameCadence = (a: PlanShape, b: PlanShape) => a.frequency_value === b.frequency_value && a.frequency_unit === b.frequency_unit && a.visits_per_period === b.visits_per_period
const onPrevious = computed(() => !!previous.value && sameCadence(shape.value, previous.value))
const onMaintenance = computed(() => sameCadence(shape.value, maintenancePreset(config.value)))
function usePrevious() {
  if (!previous.value || !plan.value) return
  shape.value = previous.value
  if (name.value === maintenanceName.value) name.value = plan.value.name
}
function useMaintenance() {
  shape.value = { ...maintenancePreset(config.value), total_visits: shape.value.total_visits }
  if (plan.value && name.value === plan.value.name) name.value = maintenanceName.value
}

const recallOn = computed(() => dischargeRecallDate(config.value.dischargeRecallMonths, new Date()))
const months = computed(() => config.value.dischargeRecallMonths)
const describeDischarge = computed(() => t(`Close the plan. Back in Recalls in ${months.value} ${months.value === 1 ? 'month' : 'months'}.`, `Cerrar el plan. Vuelve a Recordatorios a los ${months.value} ${months.value === 1 ? 'mes' : 'meses'}.`))
const membershipPeriod = computed(() => {
  const m = membership.value
  if (!m) return ''
  const n = m.billing_interval_count ?? 1
  if (m.billing_interval === 'year') return n === 1 ? t('/year', '/año') : t(` every ${n} years`, ` cada ${n} años`)
  if (m.billing_interval === 'week') return n === 1 ? t('/week', '/semana') : t(` every ${n} weeks`, ` cada ${n} semanas`)
  return n === 1 ? t('/month', '/mes') : t(` every ${n} months`, ` cada ${n} meses`)
})
const offerMembership = computed(() => kind.value === 'continue' && !!membership.value)
const membershipChosen = computed(() => offerMembership.value && withMembership.value)
// The pack is offered for the choice the clinic asked for, and only with something new in it.
const offerHabits = computed(() => habitArticles.value.length > 0 && (kind.value === 'continue' ? config.value.habitsOnStart : config.value.habitsOnDischarge))
const newHabits = computed(() => habitArticles.value.filter((a) => !a.had))

// Sends the pack, if it is ticked. Returns a sentence about it for the result, never throws.
async function sendHabits(): Promise<string> {
  if (!offerHabits.value || !withHabits.value || !newHabits.value.length) return ''
  try {
    const r = await authedFetch<{ sends: unknown[]; channel: string | null }>('/api/learn/send', { method: 'POST', body: { patientId: props.patientId, articleIds: newHabits.value.map((a) => a.id) } })
    const n = r.sends.length
    if (!n) return ''
    const how = r.channel === 'app' ? t('to their app', 'a su app') : r.channel === 'email' ? t('by email', 'por email') : t('as a link on their record', 'como enlace en su ficha')
    return t(` Habits pack sent ${how} (${n}).`, ` Paquete de hábitos enviado ${how} (${n}).`)
  } catch {
    return t(" The habits pack couldn't be sent; send it from their record.", ' No se ha podido enviar el paquete de hábitos; envíalo desde su ficha.')
  }
}

async function renew(withBono: boolean) {
  if (!plan.value || !props.editable) return
  busy.value = true
  error.value = ''
  if (kind.value === 'discharge') {
    const until = recallOn.value
    const { data, error: e } = await supabase.from('patients').update({ recall_snoozed_until: iso(until), recall_status: 'active' } as never).eq('id', props.patientId).select('id')
    if (e || !data?.length) {
      busy.value = false
      error.value = t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
      return
    }
    const habits = await sendHabits()
    busy.value = false
    finished.value =
      t(`Discharged: back in Recalls from ${until.toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long' })}.`, `Alta: vuelve a Recordatorios el ${until.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`) + habits
    emit('renewed')
    return
  }
  const label = name.value.trim() || maintenanceName.value
  let purchaseId: string | null = null
  let patientMembershipId: string | null = null
  const pkg = packages.value.find((x) => x.id === packageId.value)
  if (membershipChosen.value && membership.value) {
    patientMembershipId = activeMembershipId.value
    if (!patientMembershipId) {
      const { data: created, error: e } = await supabase
        .from('patient_memberships')
        .insert({ account_id: props.accountId, patient_id: props.patientId, membership_id: membership.value.id, membership_name: membership.value.name, price_cents: membership.value.price_cents, created_by: props.teamMemberId } as never)
        .select('id')
        .single()
      if (e || !created) {
        busy.value = false
        error.value = t("Couldn't add the membership. The plan was not created.", 'No se ha podido añadir la membresía. No se ha creado el plan.')
        return
      }
      patientMembershipId = (created as { id: string }).id
      fire('membership.new_member', { patientId: props.patientId, membershipId: patientMembershipId })
    }
  } else if (withBono && pkg) {
    const option = installments.value > 1 ? (readInstallmentOptions(pkg.installment_options).find((o) => o.installments === installments.value) ?? null) : null
    const priceCents = option ? option.installments * option.installmentCents : pkg.price_cents
    const { data: purchase, error: e } = await supabase
      .from('package_purchases')
      .insert({
        account_id: props.accountId,
        patient_id: props.patientId,
        package_id: pkg.id,
        package_name: pkg.name,
        sessions_total: pkg.session_count,
        price_cents: priceCents,
        installments: option?.installments ?? null,
        installment_cents: option?.installmentCents ?? null,
        invoice_id: null,
        owed_cents: priceCents,
        created_by: props.teamMemberId,
      } as never)
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
    name: label,
    frequency_value: shape.value.frequency_value,
    frequency_unit: shape.value.frequency_unit,
    visits_per_period: shape.value.visits_per_period,
    total_visits: shape.value.total_visits,
    started_at: startOn.value,
    payment_kind: patientMembershipId ? 'membership' : purchaseId ? 'bono' : 'per_visit',
    package_purchase_id: purchaseId,
    patient_membership_id: patientMembershipId,
    created_by: props.teamMemberId,
  } as never)
  if (e) {
    busy.value = false
    error.value = t("Couldn't create the plan. Try again.", 'No se ha podido crear el plan. Inténtalo de nuevo.')
    return
  }
  const habits = await sendHabits()
  busy.value = false
  const base = patientMembershipId
    ? t(`${label} created, paid by ${membership.value!.name}.`, `${label} creado, con ${membership.value!.name}.`)
    : purchaseId
      ? t(`${label} created, with ${pkg!.name} to collect at the desk.`, `${label} creado, con ${pkg!.name} pendiente de cobro en recepción.`)
      : t(`${label} created.`, `${label} creado.`)
  finished.value = base + habits
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
        <div class="rounded-ctl border border-line bg-surface p-2.5"><p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Visits', 'Visitas') }}</p><p class="mt-0.5 font-mono text-[18px] font-semibold text-ink-900" data-cy="plan-renewal-visits">{{ done }}/{{ plan.total_visits ?? '∞' }}</p></div>
        <div class="rounded-ctl border border-line bg-surface p-2.5"><p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Missed', 'Perdidas') }}</p><p class="mt-0.5 font-mono text-[18px] font-semibold text-ink-900">{{ missed }}</p></div>
        <div class="flex items-center rounded-ctl border border-line bg-surface p-2.5">
          <NuxtLink v-if="reportTo" :to="reportTo" class="text-[12.5px] font-semibold text-brand-text" data-cy="plan-renewal-report">{{ t('Progress report', 'Informe de revisión') }} →</NuxtLink>
        </div>
      </div>

      <template v-if="editable">
        <p class="mt-4 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Next', 'Propuesta') }}</p>
        <div class="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px]" role="radiogroup" :aria-label="t('What comes next', 'Qué sigue')">
          <div class="flex flex-col gap-2.5 rounded-ctl border bg-surface p-3" :class="kind === 'continue' ? 'border-brand ring-2 ring-brand/20' : 'border-line-control'">
            <button type="button" role="radio" :aria-checked="kind === 'continue'" class="flex flex-col items-start gap-0.5 text-left" data-cy="plan-renewal-continue" @click="choose('continue')">
              <span class="text-[13.5px] font-semibold text-ink-900">{{ t('Keep coming', 'Seguir viniendo') }}</span>
              <span v-if="kind !== 'continue'" class="text-[12px] text-ink-muted">{{ carePlanCadenceLabel(maintenancePreset(config), t) }} · {{ config.total_visits === null ? t('no end', 'sin fin') : t(`${config.total_visits} visits`, `${config.total_visits} visitas`) }}</span>
            </button>
            <template v-if="kind === 'continue'">
              <AppointmentsPlanShapeFields v-model="shape" cy-prefix="plan-renewal" />
              <p class="text-[12px] text-ink-muted" data-cy="plan-renewal-previous">
                <template v-if="onMaintenance && !onPrevious && previous">
                  {{ t("Filled in with the clinic's maintenance. Until now:", 'Rellenado con el mantenimiento de la clínica. Hasta ahora venía') }} {{ carePlanCadenceLabel(previous, t) }}:
                  <button type="button" class="font-medium text-brand-text hover:underline" data-cy="plan-renewal-use-previous" @click="usePrevious">{{ t('go back to that', 'volver a eso') }}</button>
                </template>
                <template v-else-if="!onMaintenance">
                  <button type="button" class="font-medium text-brand-text hover:underline" data-cy="plan-renewal-use-maintenance" @click="useMaintenance">{{ t("Use the clinic's maintenance", 'Usar el mantenimiento de la clínica') }}</button>
                  · {{ carePlanCadenceLabel(maintenancePreset(config), t) }}
                </template>
              </p>
            </template>
          </div>
          <button
            type="button"
            role="radio"
            :aria-checked="kind === 'discharge'"
            class="flex flex-col items-start gap-0.5 rounded-ctl border bg-surface p-3 text-left"
            :class="kind === 'discharge' ? 'border-brand ring-2 ring-brand/20' : 'border-line-control'"
            data-cy="plan-renewal-discharge"
            @click="choose('discharge')"
          >
            <span class="text-[13.5px] font-semibold text-ink-900">{{ t('Discharge', 'Alta') }}</span>
            <span class="text-[12px] text-ink-muted">{{ describeDischarge }}</span>
          </button>
        </div>

        <label v-if="offerMembership && membership" class="mt-2 flex items-start gap-2.5 rounded-ctl border border-line bg-surface p-3 text-[13.5px] text-ink-900">
          <input v-model="withMembership" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" data-cy="plan-renewal-membership" />
          <span>
            <strong>{{ membership.name }}</strong> · {{ formatEur(membership.price_cents) }}{{ membershipPeriod }}
            <span class="block text-[12px] text-ink-muted">{{ activeMembershipId ? t('They already have it: the plan is paid by it.', 'Ya la tiene: el plan se paga con ella.') : t("The clinic's membership. Collected as usual, in Money.", 'La membresía de la clínica. Se cobra como siempre, en Dinero.') }}</span>
          </span>
        </label>

        <div v-if="offerHabits" class="mt-2 rounded-ctl border border-brand/40 bg-brand-tint p-3" data-cy="plan-renewal-habits">
          <label v-if="newHabits.length" class="flex items-start gap-2.5 text-[13.5px] text-ink-900">
            <input v-model="withHabits" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" data-cy="plan-renewal-habits-send" />
            <span>
              <strong>{{ t('Send the habits pack', 'Enviar el paquete de hábitos') }}</strong> · {{ t(`${newHabits.length} ${newHabits.length === 1 ? 'reading' : 'readings'}`, `${newHabits.length} ${newHabits.length === 1 ? 'lectura' : 'lecturas'}`) }}
              <span class="block text-[12px] text-ink-muted">{{ t('To their app, with a notification; without the app, by email or as a link.', 'A su app, con un aviso; sin app, por email o con un enlace.') }}</span>
            </span>
          </label>
          <p v-else class="text-[13px] text-ink-muted">{{ t('They already have every reading in the habits pack.', 'Ya tiene todas las lecturas del paquete de hábitos.') }}</p>
          <ul class="ml-[26px] mt-2 flex flex-col gap-1 text-[12.5px] text-ink-700">
            <li v-for="a in habitArticles" :key="a.id" :class="a.had ? 'text-ink-muted' : ''" data-cy="plan-renewal-habit">
              {{ a.title }}<span class="text-ink-muted"> · {{ a.had ? t('already has it, not sent again', 'ya la tiene, no se repite') : a.video_url ? t('video', 'vídeo') : t('reading', 'lectura') }}</span>
            </li>
          </ul>
        </div>

        <div v-if="kind === 'continue'" class="mt-3 flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Plan name', 'Nombre del plan') }}<input v-model="name" :class="field" class="w-52" data-cy="plan-renewal-name" /></label>
          <label class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Starts', 'Empieza') }}<input v-model="startOn" type="date" :class="field" data-cy="plan-renewal-start" /></label>
          <label v-if="canSellBono && packages.length && !membershipChosen" class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Bono', 'Bono') }}
            <select v-model="packageId" :class="field" class="w-56" data-cy="plan-renewal-bono">
              <option value="">{{ t('None', 'Ninguno') }}</option>
              <option v-for="p in packages" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label v-if="canSellBono && packageId && !membershipChosen && packageOptions.length" class="flex flex-col gap-1 text-[12px] text-ink-muted">{{ t('Paid', 'Forma de pago') }}
            <select v-model.number="installments" :class="field" class="w-56" data-cy="plan-renewal-bono-installments">
              <option :value="1">{{ t(`At once · ${formatEur(packages.find((x) => x.id === packageId)?.price_cents ?? 0)}`, `En un pago · ${formatEur(packages.find((x) => x.id === packageId)?.price_cents ?? 0)}`) }}</option>
              <option v-for="o in packageOptions" :key="o.installments" :value="o.installments">{{ t(`${o.installments} plazos of ${formatEur(o.installmentCents)}`, `${o.installments} plazos de ${formatEur(o.installmentCents)}`) }}</option>
            </select>
          </label>
        </div>

        <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <template v-if="kind === 'discharge'">
            <UiBtn variant="primary" size="sm" :disabled="busy" data-cy="plan-renewal-confirm-discharge" @click="renew(false)">{{ t('Discharge', 'Dar el alta') }}</UiBtn>
          </template>
          <template v-else>
            <UiBtn :variant="canSellBono && packageId && !membershipChosen ? 'secondary' : 'primary'" size="sm" :disabled="busy" data-cy="plan-renewal-create" @click="renew(false)">{{ canSellBono && packageId && !membershipChosen ? t('Just create the plan', 'Solo crear el plan') : t('Create the plan', 'Crear el plan') }}</UiBtn>
            <UiBtn v-if="canSellBono && packageId && !membershipChosen" variant="primary" size="sm" :disabled="busy" data-cy="plan-renewal-create-bono" @click="renew(true)">{{ t('Create plan and add the bono', 'Crear plan y añadir bono') }}</UiBtn>
          </template>
        </div>
        <p v-if="kind === 'continue' && packageId && !membershipChosen" class="mt-1.5 text-right text-[12px] text-ink-muted">{{ t('The bono is owed in full; the desk takes the money in Money, with its factura.', 'El bono queda pendiente; recepción lo cobra en Dinero, con su factura.') }}</p>
      </template>
    </template>
  </section>
</template>
