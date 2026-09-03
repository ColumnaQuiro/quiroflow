<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

type Patient = Pick<
  Tables<'patients'>,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'tags'
  | 'clinic_id'
  | 'email'
  | 'default_practitioner_id'
  | 'invoice_email_enabled'
  | 'status'
  | 'is_minor'
  | 'do_not_contact'
>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const PAGE_SIZE = 50

interface TeamMemberOption { id: string; full_name: string }
interface CarePlanInfo { name: string; totalVisits: number; completed: number }

const search = ref('')
// Two stateful filter chips from the design. "Outstanding balance" filters
// on the live-computed patient_live_balances view, not a stored column --
// see loadPatients()/exportCsv() below.
const outstandingBalanceFilter = ref(false)
const carePlanFilter = ref(false)
const missingContact = ref<'any' | 'email' | 'phone'>('any')
const practitionerFilter = ref('')
const statusFilter = ref<'active' | 'inactive' | 'any'>('active')
const exporting = ref(false)
const showAddPatient = ref(false)
const patients = ref<Patient[]>([])
const balanceByPatient = ref<Record<string, number>>({})
const nextAppointmentByPatient = ref<Record<string, string>>({})
const carePlanByPatient = ref<Record<string, CarePlanInfo>>({})
const whatsappConsentByPatient = ref<Record<string, boolean>>({})
const primaryPhoneByPatient = ref<Record<string, string>>({})
const teamMembers = ref<TeamMemberOption[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name').order('full_name')
  teamMembers.value = data ?? []
})
const page = ref(1)
const totalCount = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

async function loadPatients() {
  loading.value = true

  // "On a care plan" is filtered via a reverse embed + !inner, the same
  // pattern VisitNotesTab uses for appointments!inner -- it narrows to
  // patients with at least one care_plans row without duplicating the
  // patient row per plan (PostgREST nests the match, it doesn't join-fan-out).
  const selectCols =
    'id, first_name, last_name, tags, clinic_id, email, default_practitioner_id, invoice_email_enabled, status, is_minor, do_not_contact' +
    (carePlanFilter.value ? ', care_plans!inner(id)' : '')

  let query = supabase.from('patients').select(selectCols, { count: 'exact' })

  if (store.currentClinicId) query = query.eq('clinic_id', store.currentClinicId)
  // balance_cents lives on a live-computed view (patient_live_balances), not
  // a column on patients -- narrow to matching ids first, same trick already
  // used below for the single-token phone search.
  if (outstandingBalanceFilter.value) {
    const { data: owing } = await supabase.from('patient_live_balances').select('patient_id').lt('balance_cents', 0)
    const owingIds = (owing ?? []).map((r) => r.patient_id!)
    query = query.in('id', owingIds.length > 0 ? owingIds : ['00000000-0000-0000-0000-000000000000'])
  }
  if (missingContact.value === 'email') query = query.or('email.is.null,email.eq.')
  if (missingContact.value === 'phone') query = query.eq('has_phone', false)
  if (practitionerFilter.value) query = query.eq('default_practitioner_id', practitionerFilter.value)
  if (statusFilter.value !== 'any') query = query.eq('status', statusFilter.value)

  // Each word must match somewhere in first/last name/email/phone -- chaining
  // .or() calls ANDs the groups together, so "john 612" matches a John whose
  // phone contains "612" regardless of which word landed in which field.
  // Phone numbers live on a separate table (patient_contact_numbers), so
  // each token gets its own lookup there alongside the name/email match --
  // the placeholder promises "Name, phone or email" for any word typed, not
  // just a lone one.
  const tokens = search.value.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)
  for (const token of tokens) {
    const { data: phoneMatches } = await supabase
      .from('patient_contact_numbers')
      .select('patient_id')
      .ilike('number', `%${token}%`)
    const phoneIds = [...new Set((phoneMatches ?? []).map((m) => m.patient_id))]
    const idClause = phoneIds.length > 0 ? `,id.in.(${phoneIds.join(',')})` : ''
    query = query.or(`search_name.ilike.%${normalizeSearchTerm(token)}%,email.ilike.%${token}%${idClause}`)
  }

  const from = (page.value - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const { data, count } = await query.order('first_name').range(from, to)

  // selectCols is built dynamically (it grows a `care_plans!inner(...)` embed
  // when the "On a care plan" chip is active), so supabase-js can't map it to
  // a literal column union and falls back to an untyped result -- same as the
  // pre-existing `care_plans` queries below, which aren't in the generated
  // Database types either. Assert back to the shape we actually select.
  patients.value = (data ?? []) as unknown as Patient[]
  totalCount.value = count ?? 0

  const ids = patients.value.map((p) => p.id)
  if (ids.length > 0) {
    const [{ data: upcoming }, { data: plans }, { data: completedAppts }, { data: contactNumbers }, { data: balances }] = await Promise.all([
      supabase
        .from('appointments')
        .select('patient_id, starts_at')
        .eq('status', 'booked')
        .gt('starts_at', new Date().toISOString())
        .in('patient_id', ids)
        .order('starts_at'),
      supabase
        .from('care_plans')
        .select('patient_id, name, total_visits, created_at')
        .in('patient_id', ids)
        .order('created_at', { ascending: false }),
      supabase.from('appointments').select('patient_id').eq('status', 'completed').in('patient_id', ids),
      supabase
        .from('patient_contact_numbers')
        .select('patient_id, number, country_code, is_whatsapp')
        .in('patient_id', ids)
        .order('created_at'),
      supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', ids),
    ])

    const balByPatient: Record<string, number> = {}
    for (const b of balances ?? []) balByPatient[b.patient_id!] = b.balance_cents ?? 0
    balanceByPatient.value = balByPatient

    const nextByPatient: Record<string, string> = {}
    for (const a of upcoming ?? []) {
      if (!nextByPatient[a.patient_id]) nextByPatient[a.patient_id] = a.starts_at
    }
    nextAppointmentByPatient.value = nextByPatient

    const completedByPatient: Record<string, number> = {}
    for (const a of completedAppts ?? []) {
      completedByPatient[a.patient_id] = (completedByPatient[a.patient_id] ?? 0) + 1
    }
    const planByPatient: Record<string, CarePlanInfo> = {}
    for (const p of plans ?? []) {
      if (!planByPatient[p.patient_id]) {
        planByPatient[p.patient_id] = { name: p.name, totalVisits: p.total_visits, completed: completedByPatient[p.patient_id] ?? 0 }
      }
    }
    carePlanByPatient.value = planByPatient

    const waByPatient: Record<string, boolean> = {}
    const phoneByPatient: Record<string, string> = {}
    for (const c of contactNumbers ?? []) {
      if (c.is_whatsapp) waByPatient[c.patient_id] = true
      if (!phoneByPatient[c.patient_id]) phoneByPatient[c.patient_id] = c.number
    }
    whatsappConsentByPatient.value = waByPatient
    primaryPhoneByPatient.value = phoneByPatient
  } else {
    nextAppointmentByPatient.value = {}
    carePlanByPatient.value = {}
    whatsappConsentByPatient.value = {}
    primaryPhoneByPatient.value = {}
    balanceByPatient.value = {}
  }

  loading.value = false
}
onMounted(loadPatients)

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value)
  loadPatients()
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => goToPage(1), 300)
})
watch([outstandingBalanceFilter, carePlanFilter, missingContact, practitionerFilter, statusFilter], () => goToPage(1))

// Export every patient matching the current filters (not just the loaded
// page) -- fetchAllRows pages past Supabase's 1000-row select() cap.
function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
// patient_live_balances has no filters of its own to page against --
// chunking a plain .in() keeps each request's id list a sane size rather
// than sending a single query with 1000+ ids.
async function fetchBalances(ids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  const CHUNK = 300
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await supabase.from('patient_live_balances').select('patient_id, balance_cents').in('patient_id', ids.slice(i, i + CHUNK))
    for (const b of data ?? []) result[b.patient_id!] = b.balance_cents ?? 0
  }
  return result
}

async function exportCsv() {
  exporting.value = true
  try {
    const selectCols =
      'id, first_name, last_name, tags, email, status, is_minor, do_not_contact' + (carePlanFilter.value ? ', care_plans!inner(id)' : '')

    let owingIds: string[] | null = null
    if (outstandingBalanceFilter.value) {
      const { data: owing } = await supabase.from('patient_live_balances').select('patient_id').lt('balance_cents', 0)
      owingIds = (owing ?? []).map((r) => r.patient_id!)
    }

    // Computed once (not per page) -- same phone-lookup-per-token approach
    // as loadPatients() above, so an exported CSV matches what's on screen.
    const tokens = search.value.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)
    const tokenIdClauses = await Promise.all(
      tokens.map(async (token) => {
        const { data: phoneMatches } = await supabase.from('patient_contact_numbers').select('patient_id').ilike('number', `%${token}%`)
        const phoneIds = [...new Set((phoneMatches ?? []).map((m) => m.patient_id))]
        return { token, idClause: phoneIds.length > 0 ? `,id.in.(${phoneIds.join(',')})` : '' }
      }),
    )

    const rows = await fetchAllRows<Patient & { tags: string[] }>((from, to) => {
      let q = supabase.from('patients').select(selectCols) as any
      if (store.currentClinicId) q = q.eq('clinic_id', store.currentClinicId)
      if (owingIds) q = q.in('id', owingIds.length > 0 ? owingIds : ['00000000-0000-0000-0000-000000000000'])
      if (missingContact.value === 'email') q = q.or('email.is.null,email.eq.')
      if (missingContact.value === 'phone') q = q.eq('has_phone', false)
      if (practitionerFilter.value) q = q.eq('default_practitioner_id', practitionerFilter.value)
      if (statusFilter.value !== 'any') q = q.eq('status', statusFilter.value)
      for (const { token, idClause } of tokenIdClauses) {
        q = q.or(`search_name.ilike.%${normalizeSearchTerm(token)}%,email.ilike.%${token}%${idClause}`)
      }
      return q.order('first_name').range(from, to)
    })

    const exportBalances = await fetchBalances(rows.map((p) => p.id))

    const header = [
      t('First name', 'Nombre'),
      t('Last name', 'Apellidos'),
      t('Email', 'Correo electrónico'),
      t('Balance', 'Saldo'),
      t('Status', 'Estado'),
      t('Under age', 'Menor de edad'),
      t('Do not contact', 'No contactar'),
      t('Tags', 'Etiquetas'),
    ]
    const csvRows = rows.map((p) => [
      p.first_name ?? '',
      p.last_name ?? '',
      p.email ?? '',
      ((exportBalances[p.id] ?? 0) / 100).toFixed(2),
      p.status ?? 'active',
      p.is_minor ? t('yes', 'sí') : t('no', 'no'),
      p.do_not_contact ? t('yes', 'sí') : t('no', 'no'),
      (p.tags ?? []).join('; '),
    ])
    const csv = [header, ...csvRows].map((cols) => cols.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    exporting.value = false
  }
}

function initials(p: Patient) {
  const a = p.first_name?.[0] ?? ''
  const b = p.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

function balancePill(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  if (cents < 0) return { text: `€${amount} ${t('due', 'pendiente')}`, class: 'bg-danger-bg text-danger-text' }
  if (cents > 0) return { text: `€${amount} ${t('cr', 'a favor')}`, class: 'bg-success-bg text-success-text' }
  return { text: '€0.00', class: 'bg-chip-bg2 text-ink-muted2' }
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function nextVisitInfo(patientId: string) {
  const iso = nextAppointmentByPatient.value[patientId]
  if (!iso) return { date: null as string | null, relative: t('No booking', 'Sin cita'), colorClass: 'text-warning-accent' }

  const visitDate = new Date(iso)
  const dateText = visitDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const timeText = visitDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const diffDays = Math.round((startOfDay(visitDate).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diffDays === 0) return { date: `${dateText} · ${timeText}`, relative: t('Today', 'Hoy'), colorClass: 'text-brand' }
  if (diffDays === 1) return { date: `${dateText} · ${timeText}`, relative: t('Tomorrow', 'Mañana'), colorClass: 'text-ink-faint' }
  if (diffDays > 1 && diffDays < 7) return { date: `${dateText} · ${timeText}`, relative: `${t('In', 'En')} ${diffDays} ${t('days', 'días')}`, colorClass: 'text-ink-faint' }
  return { date: `${dateText} · ${timeText}`, relative: visitDate.toLocaleDateString(undefined, { weekday: 'long' }), colorClass: 'text-ink-faint' }
}

// Tags are freeform per-clinic text, not an enum -- match both the design
// spec's English names and the Spanish equivalents already seeded in this
// app's demo data (e.g. "referido", "moroso"), falling back to a neutral
// chip for anything else.
const TAG_STYLES: Record<string, string> = {
  vip: 'bg-warning-bg text-warning-text',
  bono: 'bg-brand-tint text-brand-text2',
  referred: 'bg-success-bg text-success-text',
  referido: 'bg-success-bg text-success-text',
  debtor: 'bg-danger-bg text-danger-text',
  moroso: 'bg-danger-bg text-danger-text',
}
function tagClass(tag: string) {
  return TAG_STYLES[tag.toLowerCase()] ?? 'bg-chip-bg text-chip-text'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="t('Patients', 'Pacientes')"
      :meta="!loading ? `${totalCount} ${t('patients', 'pacientes')} · ${patients.length} ${t('shown', 'mostrados')}` : undefined"
    >
      <UiBtn variant="secondary" :disabled="exporting" @click="exportCsv">{{ exporting ? t('Exporting…', 'Exportando…') : t('Export', 'Exportar') }}</UiBtn>
      <UiBtn variant="secondary" @click="navigateTo('/settings/import')">{{ t('Import', 'Importar') }}</UiBtn>
      <UiBtn variant="primary" @click="showAddPatient = true">{{ t('New patient', 'Nuevo paciente') }}</UiBtn>
    </PageHeader>

    <PatientsAddPatientModal
      v-if="showAddPatient"
      @close="showAddPatient = false"
      @created="(id) => { showAddPatient = false; navigateTo(`/patients/${id}`) }"
    />

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <!-- Filter bar -->
      <div class="flex h-8 flex-wrap items-center gap-2">
        <div class="relative w-[250px]">
          <svg width="13" height="13" viewBox="0 0 14 14" class="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-ink-faint">
            <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" />
            <line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <input
            v-model="search"
            type="search"
            :placeholder="t('Name, phone or email', 'Nombre, teléfono o correo')"
            class="h-8 w-full rounded-ctl border border-line-control bg-surface pl-[30px] pr-3 text-[13px] text-ink-700 placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium"
          :class="
            outstandingBalanceFilter
              ? 'border-danger-border bg-danger-bg text-danger-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="outstandingBalanceFilter = !outstandingBalanceFilter"
        >
          <span class="h-[6px] w-[6px] shrink-0 rounded-full" :class="outstandingBalanceFilter ? 'bg-danger-text' : 'bg-ink-faint3'" />
          {{ t('Outstanding balance', 'Saldo pendiente') }}
        </button>

        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-pill border px-2.5 text-[12.5px] font-medium"
          :class="
            carePlanFilter
              ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
              : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'
          "
          @click="carePlanFilter = !carePlanFilter"
        >
          <span class="h-[6px] w-[6px] shrink-0 rounded-full" :class="carePlanFilter ? 'bg-brand' : 'bg-ink-faint3'" />
          {{ t('On a care plan', 'Con plan de tratamiento') }}
        </button>

        <div class="h-[22px] w-px bg-line" />

        <div class="relative">
          <select
            v-model="practitionerFilter"
            class="h-8 appearance-none rounded-pill border border-line-control bg-surface px-2.5 pr-6 text-[12.5px] font-medium text-ink-500 hover:border-line-controlHover focus:border-brand focus:outline-none"
          >
            <option value="">{{ t('Practitioner', 'Profesional') }}</option>
            <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
          <svg width="8" height="8" viewBox="0 0 10 10" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
            <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
          </svg>
        </div>

        <div class="relative">
          <select
            v-model="statusFilter"
            class="h-8 appearance-none rounded-pill border border-line-control bg-surface px-2.5 pr-6 text-[12.5px] font-medium text-ink-500 hover:border-line-controlHover focus:border-brand focus:outline-none"
          >
            <option value="active">{{ t('Active', 'Activo') }}</option>
            <option value="inactive">{{ t('Inactive', 'Inactivo') }}</option>
            <option value="any">{{ t('Any status', 'Cualquier estado') }}</option>
          </select>
          <svg width="8" height="8" viewBox="0 0 10 10" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
            <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
          </svg>
        </div>

        <div class="relative">
          <select
            v-model="missingContact"
            class="h-8 appearance-none rounded-pill border border-line-control bg-surface px-2.5 pr-6 text-[12.5px] font-medium text-ink-500 hover:border-line-controlHover focus:border-brand focus:outline-none"
          >
            <option value="any">{{ t('Missing contact', 'Sin contacto') }}</option>
            <option value="email">{{ t('Missing email', 'Sin correo electrónico') }}</option>
            <option value="phone">{{ t('Missing phone', 'Sin teléfono') }}</option>
          </select>
          <svg width="8" height="8" viewBox="0 0 10 10" class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
            <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
          </svg>
        </div>

        <div class="flex-1" />
        <span v-if="!loading" class="text-[12.5px] text-ink-muted2">{{ totalCount }} {{ t('results', 'resultados') }}</span>
      </div>

      <!-- Table card -->
      <div class="mt-3.5 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div class="flex items-center gap-4 border-b border-line-row bg-surface-subtle2 px-5 py-2.5 text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">
          <div class="min-w-0 flex-1">{{ t('Patient', 'Paciente') }}</div>
          <div class="w-[120px] shrink-0 text-right">{{ t('Balance', 'Saldo') }}</div>
          <div class="w-[170px] shrink-0">{{ t('Next visit', 'Próxima visita') }}</div>
          <div class="w-[220px] shrink-0">{{ t('Care plan', 'Plan de tratamiento') }}</div>
          <div class="w-[104px] shrink-0">{{ t('Comms', 'Comunicación') }}</div>
          <div class="w-[150px] shrink-0">{{ t('Tags', 'Etiquetas') }}</div>
        </div>

        <div v-if="loading">
          <div v-for="row in 8" :key="row" class="flex items-center gap-4 border-b border-line-row px-5 py-2.5 last:border-b-0">
            <div class="flex min-w-0 flex-1 items-center gap-2.5">
              <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-full" />
              <UiSkeleton class="h-3 w-36 rounded-ctlSm" />
            </div>
            <div class="w-[120px] shrink-0 flex justify-end"><UiSkeleton class="h-3 w-14 rounded-ctlSm" /></div>
            <div class="w-[170px] shrink-0"><UiSkeleton class="h-3 w-24 rounded-ctlSm" /></div>
            <div class="w-[220px] shrink-0"><UiSkeleton class="h-3 w-32 rounded-ctlSm" /></div>
            <div class="w-[104px] shrink-0"><UiSkeleton class="h-5 w-12 rounded-pill" /></div>
            <div class="w-[150px] shrink-0"><UiSkeleton class="h-5 w-20 rounded-pill" /></div>
          </div>
        </div>
        <div v-else-if="patients.length === 0" class="px-5 py-10 text-center text-[13px] text-ink-faint">{{ t('No patients found.', 'No se encontraron pacientes.') }}</div>

        <div v-else>
          <div
            v-for="patient in patients"
            :key="patient.id"
            class="flex cursor-pointer items-center gap-4 border-b border-line-row px-5 py-2.5 last:border-b-0 hover:bg-surface-subtle"
            @click="navigateTo(`/patients/${patient.id}`)"
          >
            <!-- Patient -->
            <div class="flex min-w-0 flex-1 items-center gap-2.5">
              <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10.5px] font-[650] text-brand">
                {{ initials(patient) }}
              </span>
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 truncate text-[13.5px] font-[560] text-ink-900">
                  <span class="truncate">{{ patient.first_name }} {{ patient.last_name }}</span>
                  <span v-if="patient.status === 'inactive'" class="shrink-0 rounded-pill bg-chip-bg2 px-1.5 py-0.5 text-[10px] font-[600] text-ink-faint3">{{ t('Inactive', 'Inactivo') }}</span>
                  <span v-if="patient.is_minor" class="shrink-0 rounded-pill bg-brand-tint px-1.5 py-0.5 text-[10px] font-[600] text-brand-text2">{{ t('Minor', 'Menor') }}</span>
                  <span v-if="patient.do_not_contact" class="shrink-0 rounded-pill bg-danger-bg px-1.5 py-0.5 text-[10px] font-[600] text-danger-text">{{ t('DNC', 'NC') }}</span>
                </p>
                <p class="truncate font-mono text-[11.5px] text-ink-muted2">{{ primaryPhoneByPatient[patient.id] ?? '—' }}</p>
              </div>
            </div>

            <!-- Balance -->
            <div class="w-[120px] shrink-0 text-right">
              <span class="inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[12.5px]" :class="balancePill(balanceByPatient[patient.id] ?? 0).class">
                {{ balancePill(balanceByPatient[patient.id] ?? 0).text }}
              </span>
            </div>

            <!-- Next visit -->
            <div class="w-[170px] shrink-0">
              <template v-if="nextVisitInfo(patient.id).date">
                <p class="text-[13px] text-ink-700">{{ nextVisitInfo(patient.id).date }}</p>
                <p class="text-[11.5px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
              </template>
              <p v-else class="text-[13px]" :class="nextVisitInfo(patient.id).colorClass">{{ nextVisitInfo(patient.id).relative }}</p>
            </div>

            <!-- Care plan -->
            <div class="w-[220px] shrink-0">
              <template v-if="carePlanByPatient[patient.id]">
                <div class="flex items-center justify-between gap-2">
                  <p class="min-w-0 truncate text-[12.5px] text-ink-700">{{ carePlanByPatient[patient.id].name }}</p>
                  <p class="shrink-0 font-mono text-[11px] text-ink-muted2">
                    {{ carePlanByPatient[patient.id].completed }}/{{ carePlanByPatient[patient.id].totalVisits }}
                  </p>
                </div>
                <div class="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[#EDEEF2]">
                  <div
                    class="h-full rounded-full bg-brand"
                    :style="{ width: `${Math.min(100, (carePlanByPatient[patient.id].completed / carePlanByPatient[patient.id].totalVisits) * 100)}%` }"
                  />
                </div>
              </template>
              <p v-else class="text-[12.5px] text-ink-faint2">{{ t('No plan', 'Sin plan') }}</p>
            </div>

            <!-- Comms -->
            <div class="flex w-[104px] shrink-0 items-center gap-1">
              <span
                class="rounded-pill px-1.5 py-0.5 text-[10.5px] font-[600]"
                :class="whatsappConsentByPatient[patient.id] ? 'bg-success-bg text-success-text' : 'bg-chip-bg2 text-ink-faint3'"
              >
                WA
              </span>
              <span
                class="rounded-pill px-1.5 py-0.5 text-[10.5px] font-[600]"
                :class="patient.invoice_email_enabled ? 'bg-brand-tint text-brand-text2' : 'bg-chip-bg2 text-ink-faint3'"
              >
                {{ t('Email', 'Correo') }}
              </span>
            </div>

            <!-- Tags -->
            <div class="flex w-[150px] shrink-0 flex-wrap items-center gap-1">
              <span
                v-for="tag in patient.tags"
                :key="tag"
                class="rounded-pill px-1.5 py-0.5 text-[11px] font-[560]"
                :class="tagClass(tag)"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="!loading && totalCount > 0" class="flex items-center justify-between bg-surface-subtle2 px-5 py-2.5 text-[12.5px] text-ink-muted2">
          <span>{{ t('Page', 'Página') }} {{ page }} {{ t('of', 'de') }} {{ totalPages }} · {{ totalCount }} {{ t('patients', 'pacientes') }}</span>
          <div class="flex gap-2">
            <button
              type="button"
              :disabled="page <= 1"
              class="flex h-7 items-center rounded-ctlSm border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-500 hover:border-line-controlHover disabled:cursor-not-allowed disabled:opacity-40"
              @click="goToPage(page - 1)"
            >
              {{ t('Previous', 'Anterior') }}
            </button>
            <button
              type="button"
              :disabled="page >= totalPages"
              class="flex h-7 items-center rounded-ctlSm border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-500 hover:border-line-controlHover disabled:cursor-not-allowed disabled:opacity-40"
              @click="goToPage(page + 1)"
            >
              {{ t('Next', 'Siguiente') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
