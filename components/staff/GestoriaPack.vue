<script setup lang="ts">
import { formatWorked } from '../../utils/workday'
import { formatEur } from '../../utils/billing'
import { packAbsenceText, type PackPerson } from '../../utils/staffGestoriaPack'

// The month's pack for the gestoría (owners): what they need to prepare the
// nóminas, on screen first and then as a PDF to read and a CSV to import,
// beside the registro de jornada PDF to sign. In Personal › Gestoría and in
// Informes › Gestoría. Figures from server/api/staff/gestoria-pack.
const props = defineProps<{
  /**
   * The app sets this: inside its WebView a plain link to /api/... goes
   * nowhere, so each file is fetched and handed to the share sheet instead
   * (mobile/pages/personal/index.vue). Unset, the links are ordinary
   * downloads, as on the web.
   */
  download?: (path: string, filename: string) => void
}>()
const t = useT()
const authedFetch = useAuthedFetch()

function lastMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const month = ref(lastMonth())
const pack = ref<{ employees: PackPerson[]; others: PackPerson[] } | null>(null)
const loading = ref(true)
const error = ref('')
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  error.value = ''
  try {
    const r = await authedFetch<{ employees: PackPerson[]; others: PackPerson[] }>(`/api/staff/gestoria-pack?month=${month.value}&format=json`)
    if (mine === run) pack.value = r
  } catch (e: any) {
    if (mine === run) error.value = e?.data?.statusMessage ?? t("Couldn't load the month.", 'No se ha podido cargar el mes.')
  } finally {
    if (mine === run) loading.value = false
  }
}
onMounted(load)
watch(month, load)

const url = (format: 'csv' | 'pdf') => `/api/staff/gestoria-pack?month=${month.value}&format=${format}`
const num = (n: number) => String(n).replace('.', t('.', ','))
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted'
const td = 'border-t border-line-row px-3 py-2.5 align-top text-[13px] text-ink-900'
const linkBtn = 'inline-flex h-9 items-center whitespace-nowrap rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover touch:h-11'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="gestoria-pack" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-2">
      <input v-model="month" type="month" :aria-label="t('Month', 'Mes')" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 touch:h-11" data-cy="gestoria-pack-month" />
      <span class="flex-1" />
      <template v-if="props.download">
        <button type="button" :class="linkBtn" data-cy="gestoria-pack-csv" @click="props.download(url('csv'), `gestoria-${month}.csv`)">{{ t('CSV to import', 'CSV para importar') }}</button>
        <button type="button" :class="linkBtn" data-cy="gestoria-pack-registro" @click="props.download(`/api/time-records/export?month=${month}&format=pdf`, `registro-jornada-${month}.pdf`)">{{ t('Working-time record PDF', 'Registro de jornada (PDF)') }}</button>
        <button type="button" class="inline-flex h-9 items-center whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11" data-cy="gestoria-pack-pdf" @click="props.download(url('pdf'), `gestoria-${month}.pdf`)">{{ t('Summary PDF', 'Resumen en PDF') }}</button>
      </template>
      <template v-else>
        <a :href="url('csv')" :class="linkBtn" data-cy="gestoria-pack-csv">{{ t('CSV to import', 'CSV para importar') }}</a>
        <a :href="`/api/time-records/export?month=${month}&format=pdf`" :class="linkBtn" data-cy="gestoria-pack-registro">{{ t('Working-time record PDF', 'Registro de jornada (PDF)') }}</a>
        <a :href="url('pdf')" class="inline-flex h-9 items-center whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11" data-cy="gestoria-pack-pdf">{{ t('Summary PDF', 'Resumen en PDF') }}</a>
      </template>
    </div>
    <p class="text-[12.5px] text-ink-muted">{{ t('Everything the gestoría needs to prepare the payslips: days and hours against the contract, absences with their dates, holidays, the variable pay and how it was reached, contract changes. It hands over figures; the gestoría still works out the payslip.', 'Todo lo que la gestoría necesita para hacer las nóminas: días y horas frente al contrato, ausencias con sus fechas, vacaciones, la retribución variable y cómo se llega a ella, cambios de contrato. Da las cifras; la nómina la sigue calculando la gestoría.') }}</p>
    <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

    <div v-if="loading" aria-busy="true"><UiSkeleton class="h-40 w-full rounded-card" /></div>
    <template v-else-if="pack">
      <section v-for="group in [{ key: 'employees', title: t('On the payroll', 'En nómina'), people: pack.employees }, { key: 'others', title: t('Self-employed and partners', 'Autónomos y socios'), people: pack.others }].filter((g) => g.key === 'employees' || g.people.length)" :key="group.key" class="overflow-x-auto rounded-card border border-line bg-surface" :data-cy="`gestoria-pack-${group.key}`">
        <h2 class="px-3 pt-3 text-[14.5px] font-bold text-ink-900">{{ group.title }}</h2>
        <p v-if="group.key === 'others'" class="px-3 text-[12px] text-ink-muted">{{ t('What their pay plan comes to is what they invoice, not a payroll line.', 'Lo que sale de su retribución es lo que facturan, no una línea de nómina.') }}</p>
        <table class="mt-1 w-full min-w-[760px] border-collapse">
          <thead>
            <tr>
              <th :class="th">{{ t('Person', 'Persona') }}</th>
              <th :class="th">{{ t('Days', 'Días') }}</th>
              <th :class="th">{{ t('Clocked / contract', 'Fichado / contrato') }}</th>
              <th v-if="group.key === 'employees'" :class="th">{{ t('Holidays', 'Vacaciones') }}</th>
              <th :class="th">{{ t('Absences', 'Ausencias') }}</th>
              <th :class="th">{{ group.key === 'employees' ? t('Variable', 'Variable') : t('To invoice', 'A facturar') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!group.people.length"><td :class="td" colspan="6" class="text-ink-muted">{{ t('Nobody this month.', 'Nadie este mes.') }}</td></tr>
            <tr v-for="p in group.people" :key="p.id" data-cy="gestoria-pack-row" :data-name="p.name">
              <td :class="td">
                <strong class="block font-semibold">{{ p.name }}</strong>
                <span class="block text-[12px] text-ink-muted">{{ [p.employmentLabel, p.modality, p.weeklyHours ? `${num(p.weeklyHours)} h/${t('wk', 'sem')}` : ''].filter(Boolean).join(' · ') }}</span>
                <span v-for="c in p.contractChanges" :key="c" class="block text-[12px] font-semibold text-warning-text" data-cy="gestoria-pack-change">{{ c }}</span>
              </td>
              <td :class="td" class="font-mono" data-cy="gestoria-pack-days">{{ p.daysWorked }}</td>
              <td :class="td" class="whitespace-nowrap font-mono" data-cy="gestoria-pack-hours">{{ formatWorked(p.minutesClocked) }}<span class="text-ink-muted"> / {{ p.contractedMinutes === null ? '—' : formatWorked(p.contractedMinutes) }}</span></td>
              <td v-if="group.key === 'employees'" :class="td" data-cy="gestoria-pack-holidays">
                <span class="font-mono">{{ num(p.holidayDaysThisMonth) }}</span> <span class="text-ink-muted">{{ t('this month', 'este mes') }}</span>
                <span class="block text-[12px] text-ink-muted">{{ p.holidayDaysLeft === null ? '' : t(`${num(p.holidayDaysLeft)} left`, `quedan ${num(p.holidayDaysLeft)}`) }}</span>
              </td>
              <td :class="td" data-cy="gestoria-pack-absences">
                <span v-if="!p.absences.length" class="text-ink-muted">—</span>
                <span v-for="(a, i) in p.absences" :key="i" class="block text-[12.5px]">{{ packAbsenceText(a, t) }}</span>
              </td>
              <td :class="td" class="whitespace-nowrap font-mono" data-cy="gestoria-pack-pay">{{ p.payCents === null ? '—' : formatEur(p.payCents) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
