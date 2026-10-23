<script setup lang="ts">
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'

// The statement (liquidación) a clinic sends a third party: every visit
// charged to it in a period, with the patient's policy and authorisation as
// they stood at the visit (20261023093754). Printed from the browser.
//
// Not a factura, and it says so. A factura to the third party would be a
// VeriFactu record with the third party as recipient, which this does not
// issue; see the migration's header.

definePageMeta({ layout: false })

const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const id = computed(() => String(route.params.id))
const from = computed(() => String(route.query.from ?? ''))
const to = computed(() => String(route.query.to ?? ''))

interface ChargeRow {
  id: string
  service_date: string
  description: string
  amount_cents: number
  policy_number: string | null
  authorization_number: string | null
  patients: { first_name: string; last_name: string | null; national_id: string | null } | null
}

const loading = ref(true)
const thirdParty = ref<{ name: string; tax_id: string | null; address: string | null; email: string | null } | null>(null)
const charges = ref<ChargeRow[]>([])

onMounted(async () => {
  const [{ data: tp }, rows] = await Promise.all([
    supabase.from('third_parties').select('name, tax_id, address, email').eq('id', id.value).maybeSingle(),
    fetchAllRows<ChargeRow>((f, tt) => {
      let q = supabase
        .from('third_party_charges')
        .select('id, service_date, description, amount_cents, policy_number, authorization_number, patients(first_name, last_name, national_id)')
        .eq('third_party_id', id.value)
        .eq('status', 'pending')
      if (from.value) q = q.gte('service_date', from.value)
      if (to.value) q = q.lte('service_date', to.value)
      return q.order('service_date').order('id').range(f, tt) as unknown as PromiseLike<{ data: ChargeRow[] | null; error: unknown }>
    }),
  ])
  thirdParty.value = tp
  charges.value = rows
  loading.value = false
})

const total = computed(() => charges.value.reduce((s, c) => s + c.amount_cents, 0))
const clinic = computed(() => store.currentClinic)
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('es-ES') : '')
const patientName = (c: ChargeRow) => (c.patients ? `${c.patients.first_name} ${c.patients.last_name ?? ''}`.trim() : '—')

function printPage() {
  window.print()
}

useHead({ title: computed(() => `${t('Statement', 'Liquidación')} · ${thirdParty.value?.name ?? ''}`) })
</script>

<template>
  <div class="min-h-screen bg-white px-8 py-10 text-[13px] text-black print:p-0" data-cy="tp-statement" :data-ready="loading ? undefined : 'true'">
    <div class="mx-auto max-w-[900px]">
      <div class="mb-6 flex justify-end gap-2 print:hidden">
        <button type="button" class="rounded border border-gray-300 px-3 py-1.5 text-[13px] hover:bg-gray-50" @click="printPage">{{ t('Print', 'Imprimir') }}</button>
      </div>

      <div class="flex flex-wrap justify-between gap-6">
        <div>
          <p class="text-[16px] font-bold">{{ clinic?.legal_name || clinic?.name || store.accountName }}</p>
          <p v-if="clinic?.tax_id">{{ clinic.tax_id }}</p>
          <p v-if="clinic?.address" class="whitespace-pre-line">{{ clinic.address }}</p>
        </div>
        <div class="text-right">
          <p class="text-[12px] uppercase tracking-wide text-gray-500">{{ t('To', 'Para') }}</p>
          <p class="text-[16px] font-bold" data-cy="tp-statement-name">{{ thirdParty?.name }}</p>
          <p v-if="thirdParty?.tax_id">{{ thirdParty.tax_id }}</p>
          <p v-if="thirdParty?.address" class="whitespace-pre-line">{{ thirdParty.address }}</p>
        </div>
      </div>

      <h1 class="mt-8 text-[20px] font-bold">{{ t('Statement of services', 'Liquidación de servicios') }}</h1>
      <p class="text-gray-600">{{ t('Period', 'Periodo') }}: {{ fmtDate(from) }} – {{ fmtDate(to) }}</p>

      <table class="mt-4 w-full border-collapse">
        <thead>
          <tr class="border-b-2 border-black text-left">
            <th class="py-1.5 pr-3">{{ t('Date', 'Fecha') }}</th>
            <th class="py-1.5 pr-3">{{ t('Patient', 'Paciente') }}</th>
            <th class="py-1.5 pr-3">{{ t('ID', 'DNI') }}</th>
            <th class="py-1.5 pr-3">{{ t('Policy', 'Póliza') }}</th>
            <th class="py-1.5 pr-3">{{ t('Authorisation', 'Autorización') }}</th>
            <th class="py-1.5 pr-3">{{ t('Service', 'Servicio') }}</th>
            <th class="py-1.5 text-right">{{ t('Amount', 'Importe') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && charges.length === 0">
            <td colspan="7" class="py-4 text-center text-gray-500">{{ t('No visits in this period.', 'Sin visitas en este periodo.') }}</td>
          </tr>
          <tr v-for="c in charges" :key="c.id" class="border-b border-gray-200" data-cy="tp-statement-row">
            <td class="py-1.5 pr-3">{{ fmtDate(c.service_date) }}</td>
            <td class="py-1.5 pr-3">{{ patientName(c) }}</td>
            <td class="py-1.5 pr-3">{{ c.patients?.national_id ?? '' }}</td>
            <td class="py-1.5 pr-3">{{ c.policy_number ?? '' }}</td>
            <td class="py-1.5 pr-3">{{ c.authorization_number ?? '' }}</td>
            <td class="py-1.5 pr-3">{{ c.description }}</td>
            <td class="py-1.5 text-right font-mono">{{ formatEur(c.amount_cents) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t-2 border-black font-bold">
            <td colspan="6" class="py-2">{{ t(`Total · ${charges.length} visit(s)`, `Total · ${charges.length} visita(s)`) }}</td>
            <td class="py-2 text-right font-mono" data-cy="tp-statement-total">{{ formatEur(total) }}</td>
          </tr>
        </tfoot>
      </table>

      <p class="mt-8 text-[11.5px] text-gray-500">
        {{ t('Informative statement; not an invoice.', 'Documento informativo de liquidación; no es una factura.') }}
      </p>
    </div>
  </div>
</template>
