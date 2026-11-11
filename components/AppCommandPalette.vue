<script setup lang="ts">
import type { Json } from '~/types/database.types'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'
import { formatPhoneDisplay } from '~/utils/phone'

interface PatientResult { id: string; first_name: string; last_name: string | null; date_of_birth: string | null; status: string; phone: string | null; matched: string | null }
interface NavEntry { label: string; to: string; haystack: string }
interface PatientRow { id: string; kind: 'patient'; patient: PatientResult }
interface NavRow { id: string; kind: 'nav'; nav: NavEntry }
type Row = PatientRow | NavRow

const emit = defineEmits<{ close: []; shortcuts: [] }>()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { preference } = useLang()

// "Go to" is the sidebar's own list and the Settings menu's, each already
// narrowed to what this person can open. It was a list written by hand here:
// it offered Billing and Settings to roles without them, and seven pages
// added to the sidebar since had never reached it.
const { reachableGroups } = useSidebarNavItems()
const { groups: settingsGroups } = useSettingsNavItems()

function entry(label: string, to: string, keywords = ''): NavEntry {
  return { label, to, haystack: normalizeSearchTerm(`${label} ${keywords}`) }
}
const pageEntries = computed(() => {
  const out = reachableGroups.value.flatMap((g) => g.items.map((i) => entry(g.qualified ? `${g.label} › ${i.label}` : i.label, i.to, i.keywords)))
  if (can('settings_access')) out.push(entry(t('Settings', 'Ajustes'), '/settings'))
  return out
})
// "Settings › WhatsApp": the Settings menu has a Leads and a Recalls of its
// own, and alone they would read as the pages of the same name.
const settingsEntries = computed(() => settingsGroups.value.flatMap((g) => g.items.map((i) => entry(`${t('Settings', 'Ajustes')} › ${i.label}`, i.to))))

const query = ref('')
const patients = ref<PatientResult[]>([])
const searching = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout>
// A slower, older search can answer after a newer one; only the newest lands.
let searchToken = 0

// With nothing typed, the pages of the sidebar. The forty Settings pages join
// once there is something to narrow them by. Every word has to be found, in
// any order and without accents: "ajustes equipo", "whatsapp settings".
const filteredNav = computed(() => {
  const words = normalizeSearchTerm(query.value).split(/\s+/).filter(Boolean)
  if (words.length === 0) return pageEntries.value
  return [...pageEntries.value, ...settingsEntries.value].filter((n) => words.every((w) => n.haystack.includes(w)))
})

const PATIENT_LIMIT = 8

watch(query, (q) => {
  clearTimeout(searchTimer)
  const token = ++searchToken
  if (!q.trim()) {
    patients.value = []
    searching.value = false
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    // The Patients page's own search (patients_matching, `q`): every word in
    // the name, the email, the DNI or a phone number, each an indexed column.
    // This searched the name alone, so a caller's number found nobody.
    // Whatever their status, as a search there does, and in every clinic the
    // person can see: this is "find this person", not a view of one clinic.
    const { data } = await supabase
      .rpc('patients_matching', { p_filters: { q: q.trim(), status: 'any', clinic: 'all' } as Json, p_clinic_id: store.currentClinicId ?? undefined })
      .select('id, first_name, last_name, date_of_birth, status, email, national_id')
      // Ordered by surname first: a search for a common first name returned
      // rows ordered by that same first name, so which ones you got was
      // effectively arbitrary and the only way to find anyone was to type
      // their surname. 15 patients match "laura" here, 82 match "maria".
      .order('last_name')
      .order('first_name')
      .order('id')
      .limit(PATIENT_LIMIT)
    if (token !== searchToken) return
    const rows = data ?? []
    // Names alone could not tell two María Garcías apart, and the front desk
    // asks for a date of birth or a phone to do exactly that. Read under the
    // patient's own scope like the record itself.
    const ids = rows.map((p) => p.id)
    const { data: numbers } = ids.length
      ? await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').in('patient_id', ids).order('created_at')
      : { data: [] }
    if (token !== searchToken) return
    const numbersOf = new Map<string, { number: string; country_code: string }[]>()
    for (const n of numbers ?? []) numbersOf.set(n.patient_id, [...(numbersOf.get(n.patient_id) ?? []), n])

    // What was typed that the name does not explain, so the row can show the
    // email, DNI or number it was found by.
    const words = q.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)
    patients.value = rows.map((p) => {
      const name = normalizeSearchTerm(`${p.first_name} ${p.last_name ?? ''}`)
      const other = words.filter((w) => !name.includes(normalizeSearchTerm(w))).map((w) => w.toLowerCase())
      const own = numbersOf.get(p.id) ?? []
      // The number that matched if one did, otherwise the first on record.
      const number = own.find((n) => other.some((w) => n.number.toLowerCase().includes(w))) ?? own[0]
      const matched = [p.email, p.national_id].find((v) => v && other.some((w) => v.toLowerCase().includes(w))) ?? null
      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        date_of_birth: p.date_of_birth,
        status: p.status,
        phone: number ? formatPhoneDisplay(number.number, number.country_code) : null,
        matched,
      }
    })
    searching.value = false
  }, 250)
})
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  searchToken++
})

onMounted(() => inputRef.value?.focus())

// A bare date ("1985-03-12") is a calendar date, not UTC midnight.
function birthDate(dob: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob ?? '')
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(uiLocaleTag(preference.value), { day: 'numeric', month: 'short', year: 'numeric' })
}
function detailOf(p: PatientResult) {
  return [birthDate(p.date_of_birth), p.phone, p.matched, p.status === 'inactive' ? t('Inactive', 'Inactivo') : null].filter(Boolean).join(' · ')
}

async function openPatient(id: string) {
  emit('close')
  await navigateTo(`/patients/${id}`)
}
async function goTo(to: string) {
  emit('close')
  await navigateTo(to)
}

// One list for the keyboard, patients first: focus stays in the field and
// the arrows move an "active" row, which is also the row the pointer is over
// (a combobox with a listbox, aria-activedescendant). There were no key
// handlers at all: a result was reached by tabbing through every one above.
const showPatients = computed(() => !!query.value.trim() && (searching.value || patients.value.length > 0))
const patientRows = computed<PatientRow[]>(() => (showPatients.value ? patients.value.map((p) => ({ id: `palette-patient-${p.id}`, kind: 'patient' as const, patient: p })) : []))
const navRows = computed<NavRow[]>(() => filteredNav.value.map((n) => ({ id: `palette-page-${n.to.replace(/[^a-z0-9]+/gi, '-')}`, kind: 'nav' as const, nav: n })))
const rows = computed<Row[]>(() => [...patientRows.value, ...navRows.value])

const activeId = ref<string | null>(null)
// The first result is the one Enter opens, again each time the results
// change. That includes patients landing above pages already matched: what
// was being typed was most likely a person. The same rows leave it alone.
watch(() => rows.value.map((r) => r.id).join(' '), () => (activeId.value = rows.value[0]?.id ?? null), { immediate: true })

const listRef = ref<HTMLElement | null>(null)
function move(step: 1 | -1) {
  const list = rows.value
  if (list.length === 0) return
  const at = list.findIndex((r) => r.id === activeId.value)
  // Wraps: up from the first row is the last.
  const next = at === -1 ? (step === 1 ? 0 : list.length - 1) : (at + step + list.length) % list.length
  activeId.value = list[next]?.id ?? null
  nextTick(() => listRef.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
}
function openRow(row: Row | undefined) {
  if (!row) return
  return row.kind === 'patient' ? openPatient(row.patient.id) : goTo(row.nav.to)
}
function onInputKeydown(e: KeyboardEvent) {
  // Enter that confirms an IME composition is not Enter on the list.
  if (e.isComposing) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    openRow(rows.value.find((r) => r.id === activeId.value))
  }
}

// Escape closes it, Tab stays inside it, and focus goes back to whatever
// had it before the palette opened (useFocusTrap).
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-scrim/40 px-4 pt-[15vh]" @click.self="emit('close')">
    <div ref="panel" role="dialog" aria-modal="true" :aria-label="t('Search', 'Buscar')" class="w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-popover">
      <div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <svg width="15" height="15" viewBox="0 0 14 14" class="shrink-0 text-ink-faint" aria-hidden="true"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-results"
          :aria-activedescendant="activeId ?? undefined"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          :aria-label="t('Search patients or jump to a page', 'Busca pacientes o ve a una página')"
          :placeholder="t('Search patients or jump to a page…', 'Busca pacientes o ve a una página…')"
          class="flex-1 border-0 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-faint"
          @keydown="onInputKeydown"
        />
        <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-faint2">Esc</kbd>
      </div>

      <!-- Options are not tab stops: the field keeps focus and the arrows
      move the active row, so Tab goes straight on to the footer. -->
      <div id="palette-results" ref="listRef" role="listbox" :aria-label="t('Search', 'Buscar')" class="max-h-96 overflow-y-auto py-2">
        <div v-if="showPatients" role="group" aria-labelledby="palette-group-patients">
          <div id="palette-group-patients" class="px-3 py-1 text-[11px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ t('Patients', 'Pacientes') }}</div>
          <p v-if="searching" class="px-3 py-2 text-[13px] text-ink-faint">{{ t('Searching…', 'Buscando…') }}</p>
          <button
            v-for="row in patientRows"
            :id="row.id"
            :key="row.id"
            type="button"
            role="option"
            tabindex="-1"
            :aria-selected="row.id === activeId"
            class="flex min-h-9 w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] touch:min-h-11"
            :class="row.id === activeId ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            data-cy="palette-patient"
            @mousemove="activeId = row.id"
            @click="openRow(row)"
          >
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctlSm text-[11px] font-bold text-brand" :class="row.id === activeId ? 'bg-surface' : 'bg-brand-tint'" aria-hidden="true">
              {{ (row.patient.first_name[0] ?? '').toUpperCase() }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ row.patient.first_name }} {{ row.patient.last_name }}</span>
              <span v-if="detailOf(row.patient)" class="truncate text-[12px] text-ink-muted" data-cy="palette-patient-detail">{{ detailOf(row.patient) }}</span>
            </span>
          </button>
        </div>

        <div role="group" aria-labelledby="palette-group-pages">
          <div id="palette-group-pages" class="px-3 py-1 text-[11px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ t('Go to', 'Ir a') }}</div>
          <p v-if="navRows.length === 0" class="px-3 py-2 text-[13px] text-ink-faint">{{ t('No matches.', 'Sin resultados.') }}</p>
          <button
            v-for="row in navRows"
            :id="row.id"
            :key="row.id"
            type="button"
            role="option"
            tabindex="-1"
            :aria-selected="row.id === activeId"
            class="flex min-h-9 w-full items-center px-3 py-2 text-left text-[13.5px] touch:min-h-11"
            :class="row.id === activeId ? 'bg-brand-tint text-brand-text' : 'text-ink-700'"
            data-cy="palette-page"
            :data-to="row.nav.to"
            @mousemove="activeId = row.id"
            @click="openRow(row)"
          >
            {{ row.nav.label }}
          </button>
        </div>
      </div>
      <!-- Where the single-key shortcuts are found (ShortcutsDialog). -->
      <div class="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
        <!-- For the keyboard, so not on a touch screen. -->
        <span class="flex items-center gap-1.5 text-[12.5px] text-ink-muted touch:hidden" aria-hidden="true">
          <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 font-mono text-[11px] text-ink-muted">↑↓</kbd>
          <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 font-mono text-[11px] text-ink-muted">↵</kbd>
          {{ t('Open', 'Abrir') }}
        </span>
        <button type="button" class="ml-auto flex min-h-7 items-center gap-1.5 rounded-ctlSm px-1.5 py-1 text-[12.5px] text-ink-muted hover:bg-surface-subtle hover:text-ink-700 touch:min-h-11" data-cy="palette-shortcuts" @click="emit('shortcuts')">
          {{ t('Keyboard shortcuts', 'Atajos de teclado') }}
          <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 font-mono text-[11px] text-ink-muted">?</kbd>
        </button>
      </div>
    </div>
  </div>
</template>
