<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'
import { formatPhoneDisplay } from '~/utils/phone'

interface PatientResult { id: string; first_name: string; last_name: string | null; date_of_birth: string | null; status: string; phone: string | null }

const emit = defineEmits<{ close: [] }>()
const supabase = useSupabaseClient()
const t = useT()
const { preference } = useLang()

const NAV_ITEMS = computed(() => [
  { label: t('Dashboard', 'Panel'), to: '/dashboard' },
  { label: t('My Day', 'Mi día'), to: '/practitioner' },
  { label: t('Calendar', 'Calendario'), to: '/calendar' },
  { label: t('Patients', 'Pacientes'), to: '/patients' },
  { label: t('Recalls', 'Recordatorios'), to: '/recalls' },
  { label: t('Billing', 'Facturación'), to: '/billing' },
  { label: t('Reports', 'Informes'), to: '/reports' },
  { label: t('Inbox', 'Bandeja de entrada'), to: '/inbox' },
  // Campaigns became Automations; "campaigns" still finds it.
  { label: t('Automations (campaigns)', 'Automatizaciones (campañas)'), to: '/automations' },
  // "Growth", not "Dashboard" as the sidebar calls it -- the sidebar can lean
  // on its group heading for context and this flat list cannot, so two
  // entries called Dashboard would be indistinguishable here.
  { label: t('Growth', 'Crecimiento'), to: '/growth' },
  { label: t('Growth leads', 'Contactos de crecimiento'), to: '/growth/leads' },
  { label: t('AI Receptionist', 'Recepcionista IA'), to: '/growth/receptionist' },
  { label: t('Reputation', 'Reputación'), to: '/growth/reputation' },
  { label: t('Settings', 'Ajustes'), to: '/settings' },
])

const query = ref('')
const patients = ref<PatientResult[]>([])
const searching = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout>

const filteredNav = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return NAV_ITEMS.value
  return NAV_ITEMS.value.filter((n) => n.label.toLowerCase().includes(q))
})

watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    patients.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name, date_of_birth, status')
      .ilike('search_name', `%${normalizeSearchTerm(q.trim())}%`)
      // Ordered by surname first: a search for a common first name returned
      // six rows ordered by that same first name, so which six you got was
      // effectively arbitrary and the only way to find anyone was to type
      // their surname. 15 patients match "laura" here, 82 match "maria".
      .order('last_name')
      .order('first_name')
      .limit(25)
    const rows = data ?? []
    // Names alone could not tell two María Garcías apart, and the front desk
    // asks for a date of birth or a phone to do exactly that. The first number
    // on record, read under the patient's own scope like the record itself.
    const ids = rows.map((p) => p.id)
    const { data: numbers } = ids.length
      ? await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').in('patient_id', ids).order('created_at')
      : { data: [] }
    if (query.value !== q) return
    const phoneOf = new Map<string, string>()
    for (const n of numbers ?? []) if (!phoneOf.has(n.patient_id)) phoneOf.set(n.patient_id, formatPhoneDisplay(n.number, n.country_code))
    patients.value = rows.map((p) => ({ ...p, phone: phoneOf.get(p.id) ?? null }))
    searching.value = false
  }, 250)
})

onMounted(() => inputRef.value?.focus())

// A bare date ("1985-03-12") is a calendar date, not UTC midnight.
function birthDate(dob: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob ?? '')
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(preference.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function detailOf(p: PatientResult) {
  return [birthDate(p.date_of_birth), p.phone, p.status === 'inactive' ? t('Inactive', 'Inactivo') : null].filter(Boolean).join(' · ')
}

async function openPatient(id: string) {
  emit('close')
  await navigateTo(`/patients/${id}`)
}
async function goTo(to: string) {
  emit('close')
  await navigateTo(to)
}
// Escape closes it, Tab stays inside it, and focus goes back to whatever
// had it before the palette opened (useFocusTrap).
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 pt-[15vh]" @click.self="emit('close')">
    <div ref="panel" role="dialog" aria-modal="true" :aria-label="t('Search', 'Buscar')" class="w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-popover">
      <div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <svg width="15" height="15" viewBox="0 0 14 14" class="shrink-0 text-ink-faint"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          :aria-label="t('Search patients or jump to a page', 'Busca pacientes o ve a una página')"
          :placeholder="t('Search patients or jump to a page…', 'Busca pacientes o ve a una página…')"
          class="flex-1 border-0 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-faint"
        />
        <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-faint2">Esc</kbd>
      </div>

      <div class="max-h-96 overflow-y-auto py-2">
        <template v-if="query.trim() && (searching || patients.length > 0)">
          <div class="px-3 py-1 text-[11px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ t('Patients', 'Pacientes') }}</div>
          <p v-if="searching" class="px-3 py-2 text-[13px] text-ink-faint">{{ t('Searching…', 'Buscando…') }}</p>
          <button
            v-for="p in patients"
            :key="p.id"
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle"
            data-cy="palette-patient"
            @click="openPatient(p.id)"
          >
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctlSm bg-brand-tint text-[11px] font-bold text-brand">
              {{ (p.first_name[0] ?? '').toUpperCase() }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ p.first_name }} {{ p.last_name }}</span>
              <span v-if="detailOf(p)" class="truncate text-[12px] text-ink-muted" data-cy="palette-patient-detail">{{ detailOf(p) }}</span>
            </span>
          </button>
        </template>

        <div class="px-3 py-1 text-[11px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ t('Go to', 'Ir a') }}</div>
        <p v-if="filteredNav.length === 0" class="px-3 py-2 text-[13px] text-ink-faint">{{ t('No matches.', 'Sin resultados.') }}</p>
        <button
          v-for="n in filteredNav"
          :key="n.to"
          type="button"
          class="flex w-full items-center px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle"
          @click="goTo(n.to)"
        >
          {{ n.label }}
        </button>
      </div>
    </div>
  </div>
</template>
