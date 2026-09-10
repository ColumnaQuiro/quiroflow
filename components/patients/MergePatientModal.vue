<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patient: Tables<'patients'> }>()
const emit = defineEmits<{ close: []; merged: [survivorId: string] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface Candidate {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  date_of_birth: string | null
  external_reference: string | null
  created_at: string
}

// What each side is actually holding. The whole point of the preview is that
// "the empty duplicate" often isn't -- on this account the record that looked
// blank was the one carrying a Bono 12 and 176,00 of credit -- so the counts
// are shown before anything moves, for both records, side by side.
interface Holdings {
  appointments: number
  invoices: number
  bonos: number
  docs: number
  files: number
  creditCents: number
}

const search = ref('')
const results = ref<Candidate[]>([])
const searching = ref(false)
const selected = ref<Candidate | null>(null)
// Which record survives. Defaults to the one the user opened, but the choice
// matters: the survivor keeps its own values and only its blanks are filled
// from the other, so "which one has the reference/spelling you want to keep"
// is a real decision the front desk has to make, not something to guess.
const keep = ref<'current' | 'other'>('current')
const merging = ref(false)
const error = ref('')

const mine = ref<Holdings | null>(null)
const theirs = ref<Holdings | null>(null)

const fullName = (p: { first_name: string; last_name: string | null }) => `${p.first_name} ${p.last_name ?? ''}`.trim()

const survivor = computed(() => (keep.value === 'current' ? props.patient : selected.value))
const duplicate = computed(() => (keep.value === 'current' ? selected.value : props.patient))
const survivorHoldings = computed(() => (keep.value === 'current' ? mine.value : theirs.value))
const duplicateHoldings = computed(() => (keep.value === 'current' ? theirs.value : mine.value))

async function holdingsFor(patientId: string): Promise<Holdings> {
  const countOf = async (table: 'appointments' | 'invoices' | 'package_purchases' | 'patient_docs' | 'patient_files') => {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('patient_id', patientId)
    return count ?? 0
  }
  const [appointments, invoices, bonos, docs, files, credits] = await Promise.all([
    countOf('appointments'),
    countOf('invoices'),
    countOf('package_purchases'),
    countOf('patient_docs'),
    countOf('patient_files'),
    supabase.from('account_credits').select('amount_cents').eq('patient_id', patientId),
  ])
  const creditCents = (credits.data ?? []).reduce((sum, row) => sum + (row.amount_cents ?? 0), 0)
  return { appointments, invoices, bonos, docs, files, creditCents }
}

let searchToken = 0
async function runSearch() {
  const term = search.value.trim()
  selected.value = null
  theirs.value = null
  if (term.length < 2) {
    results.value = []
    return
  }
  const token = ++searchToken
  searching.value = true
  const { data } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, date_of_birth, external_reference, created_at')
    .eq('account_id', store.accountId!)
    .neq('id', props.patient.id)
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,external_reference.ilike.%${term}%`)
    .order('first_name')
    .limit(20)
  // A slow response for an earlier term must not overwrite a newer one.
  if (token !== searchToken) return
  results.value = (data as Candidate[] | null) ?? []
  searching.value = false
}

async function choose(candidate: Candidate) {
  selected.value = candidate
  theirs.value = null
  theirs.value = await holdingsFor(candidate.id)
}

async function confirmMerge() {
  const survivorId = survivor.value?.id
  const duplicateId = duplicate.value?.id
  if (!survivorId || !duplicateId || merging.value) return

  const losing = duplicate.value!
  const keeping = survivor.value!
  const warning = t(
    `Merge ${fullName(losing)} into ${fullName(keeping)}? Every appointment, invoice, payment, bono and credit entry moves onto ${fullName(keeping)}, and the other record is deleted. This can't be undone.`,
    `¿Fusionar ${fullName(losing)} en ${fullName(keeping)}? Todas las citas, facturas, pagos, bonos y créditos pasarán a ${fullName(keeping)}, y el otro registro se eliminará. Esta acción no se puede deshacer.`,
  )
  if (!confirm(warning)) return

  merging.value = true
  error.value = ''
  try {
    const { error: rpcError } = await supabase.rpc('merge_patients', {
      p_survivor_id: survivorId,
      p_duplicate_id: duplicateId,
    })
    if (rpcError) {
      error.value = rpcError.message
      return
    }
    showToast(t('Patients merged', 'Pacientes fusionados'))
    emit('merged', survivorId)
  } finally {
    merging.value = false
  }
}

onMounted(async () => {
  mine.value = await holdingsFor(props.patient.id)
})

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-ink-900/30" @click.self="emit('close')">
    <div class="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-[640] text-ink-900">{{ t('Merge patient', 'Fusionar paciente') }}</h2>
        <button type="button" class="text-ink-faint hover:text-ink-600" @click="emit('close')">✕</button>
      </div>

      <p class="mt-2 text-[13px] text-ink-muted2">
        {{ t('Find the duplicate record for this person. Everything on it moves across and the record is deleted.', 'Busca el registro duplicado de esta persona. Todo lo suyo se traslada y el registro se elimina.') }}
      </p>

      <div class="mt-4">
        <label class="block text-sm font-medium text-ink-700" for="merge-search">{{ t('Search by name, email or reference', 'Buscar por nombre, email o referencia') }}</label>
        <input
          id="merge-search"
          v-model="search"
          type="text"
          autocomplete="off"
          class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-sm text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="runSearch"
        />
      </div>

      <p v-if="searching" class="mt-2 text-[13px] text-ink-muted2">{{ t('Searching…', 'Buscando…') }}</p>
      <p v-else-if="search.trim().length >= 2 && results.length === 0" class="mt-2 text-[13px] text-ink-muted2">
        {{ t('No other patient matches.', 'Ningún otro paciente coincide.') }}
      </p>

      <ul v-if="results.length && !selected" class="mt-2 divide-y divide-line rounded-card border border-line">
        <li v-for="r in results" :key="r.id">
          <button type="button" class="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-page" @click="choose(r)">
            <span class="text-[13px] font-medium text-ink-900">{{ fullName(r) }}</span>
            <span class="text-[12px] text-ink-muted2">
              {{ r.external_reference || t('no reference', 'sin referencia') }}
              <template v-if="r.email"> · {{ r.email }}</template>
              <template v-if="r.date_of_birth"> · {{ r.date_of_birth }}</template>
            </span>
          </button>
        </li>
      </ul>

      <template v-if="selected">
        <div class="mt-4 rounded-card border border-line">
          <div class="grid grid-cols-2 divide-x divide-line">
            <button
              type="button"
              class="px-3 py-2 text-left"
              :class="keep === 'current' ? 'bg-brand-bg' : 'hover:bg-surface-page'"
              @click="keep = 'current'"
            >
              <span class="block text-[11px] uppercase tracking-wide text-ink-muted2">{{ keep === 'current' ? t('Keeps everything', 'Conserva todo') : t('Will be deleted', 'Se eliminará') }}</span>
              <span class="block text-[13px] font-medium text-ink-900">{{ fullName(patient) }}</span>
              <span class="block text-[12px] text-ink-muted2">{{ patient.external_reference || t('no reference', 'sin referencia') }}</span>
            </button>
            <button
              type="button"
              class="px-3 py-2 text-left"
              :class="keep === 'other' ? 'bg-brand-bg' : 'hover:bg-surface-page'"
              @click="keep = 'other'"
            >
              <span class="block text-[11px] uppercase tracking-wide text-ink-muted2">{{ keep === 'other' ? t('Keeps everything', 'Conserva todo') : t('Will be deleted', 'Se eliminará') }}</span>
              <span class="block text-[13px] font-medium text-ink-900">{{ fullName(selected) }}</span>
              <span class="block text-[12px] text-ink-muted2">{{ selected.external_reference || t('no reference', 'sin referencia') }}</span>
            </button>
          </div>

          <table class="w-full border-t border-line text-[13px]">
            <thead>
              <tr class="text-ink-muted2">
                <th class="px-3 py-1.5 text-left font-medium">{{ t('Moving across', 'Se traslada') }}</th>
                <th class="px-3 py-1.5 text-right font-medium">{{ t('Kept', 'Conservado') }}</th>
                <th class="px-3 py-1.5 text-right font-medium">{{ t('Deleted', 'Eliminado') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr>
                <td class="px-3 py-1.5">{{ t('Appointments', 'Citas') }}</td>
                <td class="px-3 py-1.5 text-right">{{ survivorHoldings?.appointments ?? '—' }}</td>
                <td class="px-3 py-1.5 text-right font-medium">{{ duplicateHoldings?.appointments ?? '—' }}</td>
              </tr>
              <tr>
                <td class="px-3 py-1.5">{{ t('Invoices', 'Facturas') }}</td>
                <td class="px-3 py-1.5 text-right">{{ survivorHoldings?.invoices ?? '—' }}</td>
                <td class="px-3 py-1.5 text-right font-medium">{{ duplicateHoldings?.invoices ?? '—' }}</td>
              </tr>
              <tr>
                <td class="px-3 py-1.5">{{ t('Bonos', 'Bonos') }}</td>
                <td class="px-3 py-1.5 text-right">{{ survivorHoldings?.bonos ?? '—' }}</td>
                <td class="px-3 py-1.5 text-right font-medium">{{ duplicateHoldings?.bonos ?? '—' }}</td>
              </tr>
              <tr>
                <td class="px-3 py-1.5">{{ t('Credit', 'Crédito') }}</td>
                <td class="px-3 py-1.5 text-right">{{ survivorHoldings ? money(survivorHoldings.creditCents) : '—' }}</td>
                <td class="px-3 py-1.5 text-right font-medium">{{ duplicateHoldings ? money(duplicateHoldings.creditCents) : '—' }}</td>
              </tr>
              <tr>
                <td class="px-3 py-1.5">{{ t('Docs and files', 'Documentos y archivos') }}</td>
                <td class="px-3 py-1.5 text-right">{{ survivorHoldings ? survivorHoldings.docs + survivorHoldings.files : '—' }}</td>
                <td class="px-3 py-1.5 text-right font-medium">{{ duplicateHoldings ? duplicateHoldings.docs + duplicateHoldings.files : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-3 text-[12px] text-ink-muted2">
          {{ t('The kept record keeps its own details; only its blank fields are filled in from the other. Tags and contact numbers from both are kept.', 'El registro conservado mantiene sus datos; solo se rellenan sus campos vacíos con los del otro. Se conservan las etiquetas y los teléfonos de ambos.') }}
        </p>

        <p v-if="error" class="mt-3 text-[13px] text-danger-text">{{ error }}</p>

        <div class="mt-4 flex items-center gap-2">
          <UiBtn variant="primary" :disabled="merging" @click="confirmMerge">
            {{ merging ? t('Merging…', 'Fusionando…') : t('Merge', 'Fusionar') }}
          </UiBtn>
          <UiBtn variant="secondary" @click="selected = null">{{ t('Pick another', 'Elegir otro') }}</UiBtn>
        </div>
      </template>
    </div>
  </div>
</template>
