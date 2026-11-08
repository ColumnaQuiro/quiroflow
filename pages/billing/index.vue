<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { fetchAllRows, fetchByIds } from '~/composables/useFetchAllRows'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

interface InvoiceRow {
  id: string
  patient_id: string | null
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  patients: { first_name: string; last_name: string | null } | null
}

type StatusFilter = 'all' | 'unpaid' | 'paid' | 'void'

const supabase = useSupabaseClient()
const route = useRoute()
const t = useT()
const { can } = usePermission()

const statusFilter = ref<StatusFilter>('unpaid')
const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)
// Null until counted: "· 0" on every chip while the counts were on their way
// read as an empty clinic.
const counts = ref<Record<StatusFilter, number> | null>(null)
const outstandingCents = ref(0)
const outstandingCount = ref(0)
const statsLoaded = ref(false)

// Same 25-per-page + 10-button cap as the Patients table. This list used to
// have no .range() at all, which meant "Paid" and "All" pulled every invoice
// the account has ever issued (3,278 on production) into one un-virtualised
// <ul> -- and still silently lost everything past Supabase's 1000-row cap.
const PAGE_SIZE = 25
const page = ref(1)
const totalCount = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))
const visiblePages = computed(() => Array.from({ length: Math.min(totalPages.value, 10) }, (_, i) => i + 1))

// Carried over from the invoice detail page's "Back to billing" link so the
// row the user just came from keeps its selected treatment on return --
// doesn't affect which rows are loaded, purely cosmetic.
const highlightId = computed(() => (route.query.highlight as string) || '')

// Search by patient or receipt number, and sort. With 599 unpaid receipts a
// list in date order alone left "who owes the most" and "find this one"
// to paging. The chips, the header's outstanding and the list all follow
// the search, as they follow the patient filter.
const search = ref('')
const appliedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (q) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (appliedSearch.value = q.trim()), 300)
})
// Patients whose name matches the search, worked out once per search.
const searchPatientIds = ref<string[]>([])
async function resolveSearch() {
  const q = appliedSearch.value
  if (!q) {
    searchPatientIds.value = []
    return
  }
  const { data } = await supabase.from('patients').select('id').ilike('search_name', `%${normalizeSearchTerm(sanitizeSearchToken(q))}%`).limit(500)
  searchPatientIds.value = (data ?? []).map((p) => p.id)
}
type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest'
const sort = ref<SortKey>('newest')
const SORTS = computed<{ value: SortKey; label: string }[]>(() => [
  { value: 'newest', label: t('Newest first', 'Más recientes') },
  { value: 'oldest', label: t('Oldest first', 'Más antiguos') },
  { value: 'largest', label: t('Largest amount', 'Mayor importe') },
  { value: 'smallest', label: t('Smallest amount', 'Menor importe') },
])
// The patient filter and the search, on any query over invoices.
function scoped<Q extends { eq: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q; or: (f: string) => Q }>(q: Q): Q {
  let out = patientId.value ? q.eq('patient_id', patientId.value) : q
  const term = sanitizeSearchToken(appliedSearch.value).trim()
  if (term) {
    out = searchPatientIds.value.length
      ? out.or(`invoice_number.ilike.%${term}%,patient_id.in.(${searchPatientIds.value.join(',')})`)
      : out.ilike('invoice_number', `%${term}%`)
  }
  return out
}

// Narrows the whole page to one patient. Lives in the URL rather than in
// component state so a patient record can link straight here ("every receipt
// for this patient") and the result stays shareable and back-button safe.
const patientId = computed(() => (route.query.patient as string) || '')
const patientName = ref('')

async function loadPatientName() {
  if (!patientId.value) {
    patientName.value = ''
    return
  }
  const { data } = await supabase
    .from('patients')
    .select('first_name, last_name')
    .eq('id', patientId.value)
    .maybeSingle()
  patientName.value = data ? [data.first_name, data.last_name].filter(Boolean).join(' ') : ''
}

function clearPatientFilter() {
  const query = { ...route.query }
  delete query.patient
  navigateTo({ path: route.path, query })
}

const FILTERS = computed<{ value: StatusFilter; label: string }[]>(() => [
  { value: 'unpaid', label: t('Unpaid', 'Impagadas') },
  { value: 'paid', label: t('Paid', 'Pagadas') },
  { value: 'void', label: t('Void', 'Anuladas') },
  { value: 'all', label: t('All', 'Todas') },
])

const STATUS_TONE: Record<string, 'success' | 'danger' | 'neutral'> = {
  paid: 'success',
  unpaid: 'danger',
  void: 'neutral',
}

// Chips and pages can be clicked faster than a page of invoices comes back;
// only the newest request may fill the list.
let loadToken = 0
async function load() {
  const token = ++loadToken
  loading.value = true
  let query = scoped(supabase.from('invoices').select('id, patient_id, invoice_number, status, total_cents, created_at, patients(first_name, last_name)', { count: 'exact' }))
  if (sort.value === 'largest' || sort.value === 'smallest') query = query.order('total_cents', { ascending: sort.value === 'smallest' })
  query = query.order('created_at', { ascending: sort.value === 'oldest' }).order('id')
  if (statusFilter.value !== 'all') query = query.eq('status', statusFilter.value)

  const from = (page.value - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  if (token !== loadToken) return
  invoices.value = (data as unknown as InvoiceRow[]) ?? []
  totalCount.value = count ?? 0
  loading.value = false
}

// One head-only count per bucket, rather than fetching every invoice's status
// and tallying them in the browser. The old approach wasn't just slow, it was
// wrong: an unpaginated select() is silently capped at 1000 rows, so any
// account past that read "Paid · 1000 / All · 1000" no matter its real totals,
// and a status with no row in the first 1000 showed 0. Production has 3,278
// invoices, so the chips on screen were understating Paid by 2,258 and
// reporting the one Void invoice as none. `head: true` returns the count in a
// header with no row payload at all.
let countsToken = 0
async function loadCounts() {
  const token = ++countsToken
  const buckets: Exclude<StatusFilter, 'all'>[] = ['unpaid', 'paid', 'void']
  // Scoped to the patient filter as well as the status. A chip counting the
  // whole account while the list below shows one patient is the same class of
  // lie as the 1000-row cap this function was written to fix.
  const base = () => scoped(supabase.from('invoices').select('id', { count: 'exact', head: true }))
  const [all, ...rest] = await Promise.all([
    base(),
    ...buckets.map((status) => base().eq('status', status)),
  ])
  if (token !== countsToken) return
  const next: Record<StatusFilter, number> = { all: all.count ?? 0, unpaid: 0, paid: 0, void: 0 }
  buckets.forEach((status, i) => {
    next[status] = rest[i]?.count ?? 0
  })
  counts.value = next
}

async function loadOutstanding() {
  // fetchAllRows rather than a bare select() for that same 1000-row cap -- an
  // account carrying more unpaid invoices than that silently under-reported
  // what it is owed in the header.
  const rows = await fetchAllRows<{ id: string; total_cents: number }>((from, to) =>
    scoped(supabase.from('invoices').select('id, total_cents').eq('status', 'unpaid')).order('id').range(from, to),
  )
  const ids = rows.map((r) => r.id)

  const paidByInvoice: Record<string, number> = {}
  // By chunk as well as by page: every unpaid invoice in the account is more
  // ids than one URL holds long before it is more rows than one page.
  const pays = await fetchByIds(ids, (chunk) =>
    fetchAllRows<{ invoice_id: string | null; amount_cents: number }>((from, to) =>
      supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', chunk).range(from, to),
    ).then((data) => ({ data, error: null })),
  )
  for (const p of pays) if (p.invoice_id) paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] ?? 0) + p.amount_cents

  outstandingCents.value = rows.reduce((sum, r) => sum + Math.max(0, r.total_cents - (paidByInvoice[r.id] ?? 0)), 0)
  outstandingCount.value = rows.length
  statsLoaded.value = true
}

onMounted(() => {
  load()
  loadCounts()
  loadOutstanding()
  loadPatientName()
})
watch(statusFilter, () => {
  page.value = 1
  selected.value = new Set()
  load()
})
watch(sort, () => {
  page.value = 1
  load()
})
watch(appliedSearch, async () => {
  await resolveSearch()
  page.value = 1
  selected.value = new Set()
  counts.value = null
  statsLoaded.value = false
  load()
  loadCounts()
  loadOutstanding()
})
watch(patientId, () => {
  page.value = 1
  counts.value = null
  load()
  loadCounts()
  loadOutstanding()
  loadPatientName()
})

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  selected.value = new Set()
  load()
}

// Unpaid receipts can be ticked and their patients sent a WhatsApp template
// together (BulkSendWhatsAppModal, as from Recalls) -- the same send and the
// same permission. Whoever has no phone, is a minor or asked not to be
// contacted is left out before the dialog opens, and counted.
const canRemind = computed(() => statusFilter.value === 'unpaid' && can('recalls_access'))
const selected = ref(new Set<string>())
function toggleSelected(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
const allOnPageSelected = computed(() => invoices.value.length > 0 && invoices.value.every((i) => selected.value.has(i.id)))
function toggleAllOnPage() {
  selected.value = allOnPageSelected.value ? new Set() : new Set(invoices.value.map((i) => i.id))
}
const remindTargets = ref<{ patientId: string; firstName: string }[] | null>(null)
const remindSkipped = ref(0)
async function openRemind() {
  const ids = [...new Set(invoices.value.filter((i) => selected.value.has(i.id) && i.patient_id).map((i) => i.patient_id!))]
  if (!ids.length) return
  const { data } = await supabase.from('patients').select('id, first_name, has_phone, is_minor, do_not_contact').in('id', ids)
  const reachable = (data ?? []).filter((p) => p.has_phone && !p.is_minor && !p.do_not_contact)
  remindSkipped.value = ids.length - reachable.length
  remindTargets.value = reachable.map((p) => ({ patientId: p.id, firstName: p.first_name }))
}
function onReminded() {
  remindTargets.value = null
  remindSkipped.value = 0
  selected.value = new Set()
}

const outstandingMeta = computed(() => {
  if (!statsLoaded.value) return undefined
  // formatEur like every other amount: this was the one euro figure built by
  // hand, in English style ("€33,842"), on a page that writes "45,00 €".
  const amount = formatEur(outstandingCents.value)
  const noun = outstandingCount.value === 1 ? t('receipt', 'recibo') : t('receipts', 'recibos')
  return t(
    `${amount} outstanding across ${outstandingCount.value} ${noun}`,
    `${amount} pendiente en ${outstandingCount.value} ${noun}`,
  )
})

function initials(row: InvoiceRow) {
  const f = row.patients?.first_name?.[0] ?? ''
  const l = row.patients?.last_name?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
}

// In the interface language, with the year once it is not this one: sorted
// oldest first, "3 Mar" no longer says which March.
function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
// The receipt page's words ("Pendiente", capitalised), so a receipt does not
// read "impagado" in the list and "Pendiente" once opened.
function statusLabel(status: string) {
  const label = PATIENT_INVOICE_STATUS[status]?.label
  return label ? t(label[0], label[1]) : status
}

// Says which filter emptied the list. "No receipts yet." under Unpaid, on a
// clinic with 552 paid ones, claimed the clinic had never issued any.
const emptyState = computed(() => {
  if (appliedSearch.value) return { title: t('No receipts match this search.', 'Ningún recibo coincide con la búsqueda.'), description: t('Try a patient name or a receipt number.', 'Prueba con el nombre de un paciente o un número de recibo.') }
  if (patientId.value) return { title: t('No receipts for this patient.', 'Este paciente no tiene recibos.'), description: '' }
  if (statusFilter.value === 'unpaid') return { title: t('No unpaid receipts.', 'No hay recibos impagados.'), description: t('Receipts still waiting for payment will show here.', 'Aquí aparecerán los recibos pendientes de cobro.') }
  if (statusFilter.value === 'paid') return { title: t('No paid receipts.', 'No hay recibos pagados.'), description: '' }
  if (statusFilter.value === 'void') return { title: t('No void receipts.', 'No hay recibos anulados.'), description: '' }
  return { title: t('No receipts yet.', 'Todavía no hay recibos.'), description: '' }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Billing', 'Facturación')" :meta="outstandingMeta">
      <UiBtn variant="secondary" @click="navigateTo('/settings/services')">{{ t('Services & products', 'Servicios y productos') }}</UiBtn>
      <UiBtn variant="secondary" data-cy="billing-third-parties" @click="navigateTo('/billing/third-parties')">{{ t('Third parties', 'Terceros') }}</UiBtn>
      <UiBtn variant="primary" @click="navigateTo('/billing/new')">+ {{ t('Quick receipt', 'Recibo rápido') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page p-4 sm:p-6">
      <div class="mx-auto max-w-xl">
        <!-- The active patient filter, as a removable chip. Shown above the
             status chips because it scopes them: with it on, "Unpaid · 3"
             means three for this patient, not three for the clinic. -->
        <div v-if="patientId" class="mb-3 flex flex-wrap items-center gap-2">
          <span class="flex h-7 items-center gap-2 rounded-pill border border-brand-tintBorder bg-brand-tint pl-3 pr-1.5 text-[12.5px] font-medium text-brand-text">
            {{ patientName || t('This patient', 'Este paciente') }}
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded-full text-brand-text hover:bg-brand-tintDeep relative touch:after:absolute touch:after:-inset-3 touch:after:content-['']"
              :aria-label="t('Show every patient', 'Mostrar todos los pacientes')"
              @click="clearPatientFilter"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </span>
          <NuxtLink :to="`/patients/${patientId}`" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover">
            {{ t('Open patient record', 'Abrir ficha del paciente') }}
          </NuxtLink>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="f in FILTERS"
            :key="f.value"
            type="button"
            class="flex h-8 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium transition-colors touch:h-11"
            :class="
              statusFilter === f.value
                ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
                : 'border-line-control bg-surface text-ink-muted hover:border-line-controlHover'
            "
            @click="statusFilter = f.value"
          >
            {{ f.label }}
            <span v-if="counts" class="tabular-nums" :class="statusFilter === f.value ? 'text-brand-text/70' : 'text-ink-faint2'">
              &middot; {{ counts[f.value] }}
            </span>
            <UiSkeleton v-else class="h-3 w-4 rounded-ctlSm" />
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <label class="relative min-w-0 flex-1 basis-56">
            <span class="sr-only">{{ t('Search receipts', 'Buscar recibos') }}</span>
            <svg width="13" height="13" viewBox="0 0 14 14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
            <input
              v-model="search"
              type="search"
              data-cy="billing-search"
              :placeholder="t('Patient or receipt number', 'Paciente o número de recibo')"
              class="h-8 w-full rounded-ctl border border-line-control bg-surface pl-8 pr-2.5 text-[13px] text-ink-900 placeholder:text-ink-faint focus:border-brand focus:shadow-focus focus:outline-none touch:h-11"
            />
          </label>
          <label class="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
            <span class="sr-only">{{ t('Sort', 'Ordenar') }}</span>
            <select v-model="sort" data-cy="billing-sort" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 touch:h-11">
              <option v-for="o in SORTS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
        </div>

        <UiEmptyState v-if="!loading && invoices.length === 0" class="mt-4 !px-0 !py-0" :title="emptyState.title" :description="emptyState.description || undefined" data-cy="billing-empty">
          <template #icon>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 2.75h10v14.5l-2.5-1.5-2.5 1.5-2.5-1.5L5 17.25V2.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
              <path d="M7.5 7h5M7.5 10h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </template>
          <template v-if="!appliedSearch && !patientId && statusFilter === 'all'" #actions>
            <UiBtn variant="primary" @click="navigateTo('/billing/new')">{{ t('Quick receipt', 'Recibo rápido') }}</UiBtn>
          </template>
        </UiEmptyState>
        <div v-else class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <!-- Selecting unpaid receipts to remind their patients (openRemind). -->
          <div v-if="canRemind && !loading && invoices.length" class="flex min-h-11 items-center gap-3 border-b border-line-row px-4 py-2" data-cy="billing-select-bar">
            <input type="checkbox" class="h-4 w-4 accent-brand touch:h-5 touch:w-5" :checked="allOnPageSelected" :aria-label="t('Select every receipt on this page', 'Seleccionar todos los recibos de esta página')" data-cy="billing-select-page" @change="toggleAllOnPage" />
            <span class="flex-1 text-[12.5px] text-ink-muted">
              {{ selected.size ? t(`${selected.size} selected`, `${selected.size} seleccionados`) : t('Select receipts to remind their patients', 'Selecciona recibos para recordárselo a sus pacientes') }}
            </span>
            <UiBtn v-if="selected.size" variant="primary" size="sm" data-cy="billing-remind" @click="openRemind">{{ t('Send WhatsApp', 'Enviar WhatsApp') }}</UiBtn>
          </div>
          <p v-if="remindTargets && remindSkipped" role="status" class="border-b border-line-row bg-warning-bg px-4 py-2 text-[12.5px] text-warning-text" data-cy="billing-remind-skipped">
            {{
              t(
                `${remindSkipped} ${remindSkipped === 1 ? 'patient is' : 'patients are'} left out: no phone, a minor, or asked not to be contacted.`,
                `${remindSkipped} ${remindSkipped === 1 ? 'paciente queda' : 'pacientes quedan'} fuera: sin teléfono, menor o no quiere ser contactado.`,
              )
            }}
          </p>
          <div v-if="loading" class="divide-y divide-line-row">
            <div v-for="i in 4" :key="i" class="flex items-center justify-between gap-3 px-4 py-3">
              <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
              <UiSkeleton class="h-3.5 w-16 rounded-ctlSm" />
            </div>
          </div>
          <ul v-else class="divide-y divide-line-row">
            <li
              v-for="invoice in invoices"
              :key="invoice.id"
              class="relative flex cursor-pointer items-center justify-between gap-3 px-4 py-3 focus-within:bg-surface-subtle"
              :class="
                invoice.id === highlightId
                  ? 'bg-brand-tintDeep shadow-[inset_3px_0_0_theme(colors.brand.DEFAULT)]'
                  : 'hover:bg-surface-subtle'
              "
              data-cy="billing-row"
              @click="navigateTo(`/billing/${invoice.id}`)"
            >
              <div class="flex min-w-0 items-center gap-3">
                <input
                  v-if="canRemind"
                  type="checkbox"
                  class="relative z-10 h-4 w-4 shrink-0 accent-brand touch:h-5 touch:w-5"
                  :checked="selected.has(invoice.id)"
                  :aria-label="t(`Select receipt ${invoice.invoice_number}`, `Seleccionar recibo ${invoice.invoice_number}`)"
                  data-cy="billing-row-select"
                  @click.stop
                  @change="toggleSelected(invoice.id)"
                />
                <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
                  {{ initials(invoice) }}
                </span>
                <div class="min-w-0">
                  <NuxtLink :to="`/billing/${invoice.id}`" class="block truncate text-[13.5px] font-[560] text-ink-800 after:absolute after:inset-0 focus-visible:outline-none" @click.stop>
                    {{ invoice.patients?.first_name }} {{ invoice.patients?.last_name }}
                  </NuxtLink>
                  <p class="mt-0.5 truncate font-mono text-[11.5px] text-ink-muted2">
                    {{ invoice.invoice_number }} &middot; {{ formatDate(invoice.created_at) }}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="font-mono text-[13px] font-semibold text-ink-900">{{ formatEur(invoice.total_cents) }}</span>
                <UiPill :tone="STATUS_TONE[invoice.status] ?? 'neutral'">{{ statusLabel(invoice.status) }}</UiPill>
              </div>
            </li>
          </ul>

          <UiPaginationFooter
            v-if="!loading && totalPages > 1"
            :page="page"
            :visible-pages="visiblePages"
            :has-prev="page > 1"
            :has-next="page < totalPages"
            :summary="`${t('Page', 'Página')} ${page} ${t('of', 'de')} ${totalPages} · ${totalCount} ${totalCount === 1 ? t('receipt', 'recibo') : t('receipts', 'recibos')}`"
            @go-to-page="goToPage"
          />
        </div>
      </div>
    </div>

    <BulkSendWhatsAppModal v-if="remindTargets?.length" :targets="remindTargets" @close="remindTargets = null" @sent="onReminded" />
  </div>
</template>
