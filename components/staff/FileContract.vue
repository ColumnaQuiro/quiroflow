<script setup lang="ts">
import { clinicDateOf } from '../../utils/clinicClock'
import { CONTRACT_MODALITIES, EMPLOYMENT_TYPES, contractEnded, currentContract, daysUntilEnd, CONTRACT_ENDING_SOON_DAYS, employmentTypeLabel, modalityLabel, sortContracts, type StaffContract } from '../../utils/staffContracts'

// A person's file › Contrato: how they work for the clinic (staff_contracts).
// A new contract -- a temporal made indefinido, a change of hours -- adds a
// row, so the history stays; editing a row is for correcting it. Owners
// write (RLS); the person can read their own.
const props = defineProps<{ accountId: string; memberId: string; timeZone: string }>()
const emit = defineEmits<{ changed: [current: StaffContract | null] }>()
const t = useT()
const { preference: lang } = useLang()
const supabase = useSupabaseClient()
const store = useAccountStore()

const contracts = ref<StaffContract[]>([])
const loaded = ref(false)
const error = ref('')
const today = computed(() => clinicDateOf(new Date(), props.timeZone))

async function load() {
  const { data, error: e } = await supabase
    .from('staff_contracts')
    .select('id, team_member_id, employment_type, modality, starts_on, ends_on, weekly_hours, job_title, convenio, created_at')
    .eq('account_id', props.accountId)
    .eq('team_member_id', props.memberId)
  error.value = e ? t("Couldn't load the contracts.", 'No se han podido cargar los contratos.') : ''
  contracts.value = sortContracts(((data as StaffContract[] | null) ?? []).map((c) => ({ ...c, weekly_hours: c.weekly_hours === null ? null : Number(c.weekly_hours) })))
  loaded.value = true
  emit('changed', current.value)
}
onMounted(load)

const current = computed(() => currentContract(contracts.value, today.value))
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toLocaleString(lang.value === 'es' ? 'es-ES' : 'en-GB'))
function spanOf(c: StaffContract) {
  if (c.starts_on && c.ends_on) return `${fmt(c.starts_on)} – ${fmt(c.ends_on)}`
  if (c.starts_on) return t(`from ${fmt(c.starts_on)}`, `desde el ${fmt(c.starts_on)}`)
  if (c.ends_on) return t(`until ${fmt(c.ends_on)}`, `hasta el ${fmt(c.ends_on)}`)
  return t('no dates', 'sin fechas')
}
function statusOf(c: StaffContract): { text: string; tone: 'success' | 'warning' | 'neutral' | 'brand' } {
  if (c === current.value && c.starts_on && c.starts_on > today.value) return { text: t('Starts later', 'Empieza más adelante'), tone: 'brand' }
  if (contractEnded(c, today.value)) return { text: t('Ended', 'Terminado'), tone: 'neutral' }
  if (c !== current.value) return { text: c.starts_on && c.starts_on > today.value ? t('Starts later', 'Empieza más adelante') : t('Replaced', 'Sustituido'), tone: c.starts_on && c.starts_on > today.value ? 'brand' : 'neutral' }
  const days = daysUntilEnd(c, today.value)
  if (days !== null && days <= CONTRACT_ENDING_SOON_DAYS) return { text: days === 0 ? t('Ends today', 'Termina hoy') : t(`Ends in ${days} days`, `Termina en ${days} días`), tone: 'warning' }
  return { text: t('Current', 'Vigente'), tone: 'success' }
}

// ---- the form: a new contract, or correcting one
const editing = ref<string | 'new' | null>(null)
const form = reactive({ employment_type: 'employee' as string, modality: '' as string, starts_on: '', ends_on: '', weekly_hours: '', job_title: '', convenio: '' })
const saving = ref(false)
const formError = ref('')
function openNew() {
  // A new contract starts from the current one: usually only the modalidad,
  // the hours or the dates change.
  const c = current.value
  Object.assign(form, {
    employment_type: c?.employment_type ?? 'employee',
    modality: c?.modality ?? '',
    starts_on: today.value,
    ends_on: '',
    weekly_hours: c?.weekly_hours ? String(c.weekly_hours) : '',
    job_title: c?.job_title ?? '',
    convenio: c?.convenio ?? '',
  })
  formError.value = ''
  editing.value = 'new'
}
function openEdit(c: StaffContract) {
  Object.assign(form, {
    employment_type: c.employment_type,
    modality: c.modality ?? '',
    starts_on: c.starts_on ?? '',
    ends_on: c.ends_on ?? '',
    weekly_hours: c.weekly_hours ? String(c.weekly_hours) : '',
    job_title: c.job_title ?? '',
    convenio: c.convenio ?? '',
  })
  formError.value = ''
  editing.value = c.id
}
const hours = computed(() => {
  const v = form.weekly_hours.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 80 ? Math.round(n * 10) / 10 : NaN
})
const problem = computed(() => {
  if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) return t('The end date is before the start.', 'La fecha de fin es anterior a la de inicio.')
  if (Number.isNaN(hours.value)) return t('Weekly hours: a number from 1 to 80.', 'Horas semanales: un número de 1 a 80.')
  return ''
})
async function save() {
  if (problem.value) return
  saving.value = true
  formError.value = ''
  const row = {
    employment_type: form.employment_type,
    modality: form.employment_type === 'employee' ? form.modality || null : null,
    starts_on: form.starts_on || null,
    ends_on: form.ends_on || null,
    weekly_hours: hours.value,
    job_title: form.job_title.trim() || null,
    convenio: form.convenio.trim() || null,
  }
  const { error: e } =
    editing.value === 'new'
      ? await supabase.from('staff_contracts').insert({ ...row, account_id: props.accountId, team_member_id: props.memberId, created_by: store.teamMember?.id ?? null })
      : await supabase.from('staff_contracts').update(row).eq('id', editing.value!)
  saving.value = false
  if (e) {
    formError.value = e.message
    return
  }
  editing.value = null
  await load()
}

const removing = ref<StaffContract | null>(null)
const removeBusy = ref(false)
async function remove() {
  if (!removing.value) return
  removeBusy.value = true
  const { error: e } = await supabase.from('staff_contracts').delete().eq('id', removing.value.id)
  removeBusy.value = false
  if (e) {
    error.value = e.message
    return
  }
  removing.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-ink-700'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="file-contract" :data-ready="loaded ? 'true' : undefined">
    <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

    <div class="flex flex-wrap items-center gap-3">
      <p class="flex-1 text-[13px] text-ink-muted">{{ t('A new contract — fixed-term made permanent, a change of hours — goes in as a new one, so the history stays. Edit one only to correct it.', 'Un contrato nuevo (un temporal que pasa a indefinido, un cambio de horas) se añade como nuevo, y así queda el historial. Edita uno solo para corregirlo.') }}</p>
      <UiBtn v-if="editing !== 'new'" variant="primary" size="sm" data-cy="contract-new" @click="openNew">{{ t('New contract', 'Nuevo contrato') }}</UiBtn>
    </div>

    <form v-if="editing" class="flex flex-col gap-4 rounded-card border border-line bg-surface px-4 py-4" data-cy="contract-form" @submit.prevent="save">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ editing === 'new' ? t('New contract', 'Nuevo contrato') : t('Correct this contract', 'Corregir este contrato') }}</h2>
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-semibold text-ink-700">{{ t('Works as', 'Trabaja como') }}</span>
        <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Works as', 'Trabaja como')">
          <button
            v-for="k in EMPLOYMENT_TYPES"
            :key="k"
            type="button"
            class="h-8 touch:h-11 rounded-full border px-3 text-[13px] font-semibold"
            :class="form.employment_type === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
            :aria-pressed="form.employment_type === k"
            :data-cy="`contract-type-${k}`"
            @click="form.employment_type = k"
          >
            {{ employmentTypeLabel(k, t) }}
          </button>
        </div>
        <span class="text-[12px] text-ink-muted">
          {{ form.employment_type === 'employee' ? t('On the payroll: gets payslips and a holiday allowance.', 'Por cuenta ajena: recibe nóminas y tiene días de vacaciones.') : form.employment_type === 'self_employed' ? t('Invoices the clinic: no payslips and no holiday allowance.', 'Factura a la clínica: sin nóminas ni días de vacaciones.') : t('A partner in the clinic: no payslips and no holiday allowance.', 'Socio de la clínica: sin nóminas ni días de vacaciones.') }}
        </span>
      </div>
      <div class="flex flex-wrap gap-3">
        <label v-if="form.employment_type === 'employee'" :class="label">
          {{ t('Contract type', 'Modalidad') }}
          <select v-model="form.modality" :class="inputClass" data-cy="contract-modality">
            <option value="">{{ t('Not set', 'Sin indicar') }}</option>
            <option v-for="m in CONTRACT_MODALITIES" :key="m" :value="m">{{ modalityLabel(m, t) }}</option>
          </select>
        </label>
        <label :class="label">
          {{ t('From', 'Desde') }}
          <input v-model="form.starts_on" type="date" :class="inputClass" data-cy="contract-from" />
        </label>
        <label :class="label">
          {{ t('Until', 'Hasta') }}
          <input v-model="form.ends_on" type="date" :min="form.starts_on || undefined" :class="inputClass" data-cy="contract-to" />
          <span class="text-[12px] font-normal text-ink-muted">{{ t('Empty if it has no end.', 'Vacío si no tiene fin.') }}</span>
        </label>
        <label :class="label">
          {{ t('Hours a week', 'Horas semanales') }}
          <input v-model="form.weekly_hours" type="text" inputmode="decimal" class="w-28" :class="inputClass" data-cy="contract-hours" />
          <span class="text-[12px] font-normal text-ink-muted">{{ t('Turnos warns above this.', 'Turnos avisa si se pasa.') }}</span>
        </label>
      </div>
      <div class="flex flex-wrap gap-3">
        <label :class="label" class="min-w-[14rem] flex-1">
          {{ t('Job title', 'Puesto') }}
          <input v-model="form.job_title" type="text" maxlength="120" :class="inputClass" data-cy="contract-title" />
        </label>
        <label :class="label" class="min-w-[14rem] flex-1">
          {{ t('Collective agreement', 'Convenio') }}
          <input v-model="form.convenio" type="text" maxlength="200" :class="inputClass" data-cy="contract-convenio" />
        </label>
      </div>
      <p v-if="formError || problem" role="alert" class="text-[13px] text-danger-text">{{ formError || problem }}</p>
      <div class="flex gap-2">
        <UiBtn variant="primary" type="submit" :disabled="saving || !!problem" data-cy="contract-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn variant="ghost" data-cy="contract-cancel" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>

    <div v-if="!loaded" class="flex flex-col gap-2" aria-busy="true">
      <UiSkeleton class="h-24 w-full rounded-card" />
    </div>
    <UiEmptyState v-else-if="!contracts.length && editing !== 'new'" :title="t('No contract recorded yet.', 'Todavía no hay ningún contrato.')" :description="t('Whether they are on the payroll, self-employed or a partner decides whether they get payslips and a holiday allowance.', 'Si está en nómina, es autónomo o es socio decide si tiene nóminas y días de vacaciones.')" data-cy="contract-empty" />
    <ul v-else class="flex flex-col gap-3">
      <li v-for="c in contracts" :key="c.id" class="flex flex-col gap-2 rounded-card border bg-surface px-4 py-3" :class="c === current ? 'border-brand/40' : 'border-line'" data-cy="contract-row" :data-current="c === current ? 'true' : undefined">
        <div class="flex flex-wrap items-center gap-2">
          <strong class="text-[14.5px] text-ink-900" data-cy="contract-type">{{ employmentTypeLabel(c.employment_type, t) + (c.modality ? ` · ${modalityLabel(c.modality, t)}` : '') }}</strong>
          <UiPill :tone="statusOf(c).tone" data-cy="contract-status">{{ statusOf(c).text }}</UiPill>
          <span class="flex-1" />
          <UiBtn size="sm" variant="ghost" data-cy="contract-edit" @click="openEdit(c)">{{ t('Correct', 'Corregir') }}</UiBtn>
          <UiBtn size="sm" variant="ghost" data-cy="contract-delete" @click="removing = c">{{ t('Delete', 'Borrar') }}</UiBtn>
        </div>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt class="text-ink-muted">{{ t('Dates', 'Fechas') }}</dt>
          <dd class="text-ink-900" data-cy="contract-dates">{{ spanOf(c) }}</dd>
          <template v-if="c.weekly_hours">
            <dt class="text-ink-muted">{{ t('Hours a week', 'Horas semanales') }}</dt>
            <dd class="font-mono text-ink-900" data-cy="contract-weekly">{{ fmtHours(c.weekly_hours) }} h</dd>
          </template>
          <template v-if="c.job_title">
            <dt class="text-ink-muted">{{ t('Job title', 'Puesto') }}</dt>
            <dd class="text-ink-900">{{ c.job_title }}</dd>
          </template>
          <template v-if="c.convenio">
            <dt class="text-ink-muted">{{ t('Agreement', 'Convenio') }}</dt>
            <dd class="text-ink-900">{{ c.convenio }}</dd>
          </template>
        </dl>
      </li>
    </ul>

    <UiConfirmDialog
      v-if="removing"
      tone="danger"
      :title="t('Delete this contract?', '¿Borrar este contrato?')"
      :confirm-label="t('Delete', 'Borrar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="removeBusy"
      @confirm="remove"
      @cancel="removing = null"
    >
      <p class="text-[14px] text-ink-500">{{ t('Only for one entered by mistake. A contract that ended stays in the history: add the new one instead.', 'Solo para uno introducido por error. Un contrato que terminó se queda en el historial: añade el nuevo en su lugar.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
