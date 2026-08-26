<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'

interface PatientResult { id: string; first_name: string; last_name: string | null }

const emit = defineEmits<{ close: [] }>()
const supabase = useSupabaseClient()

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'My Day', to: '/practitioner' },
  { label: 'Calendar', to: '/calendar' },
  { label: 'Patients', to: '/patients' },
  { label: 'Recalls', to: '/recalls' },
  { label: 'Billing', to: '/billing' },
  { label: 'Reports', to: '/reports' },
  { label: 'Campaigns', to: '/campaigns' },
  { label: 'Settings', to: '/settings' },
]

const query = ref('')
const patients = ref<PatientResult[]>([])
const searching = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout>

const filteredNav = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return NAV_ITEMS
  return NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q))
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
      .select('id, first_name, last_name')
      .ilike('search_name', `%${normalizeSearchTerm(q.trim())}%`)
      .order('first_name')
      .limit(6)
    patients.value = data ?? []
    searching.value = false
  }, 250)
})

onMounted(() => inputRef.value?.focus())

async function openPatient(id: string) {
  emit('close')
  await navigateTo(`/patients/${id}`)
}
async function goTo(to: string) {
  emit('close')
  await navigateTo(to)
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(20,22,30,.32)] pt-[15vh]" @click.self="emit('close')" @keydown="onKeydown">
    <div class="w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-popover">
      <div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <svg width="15" height="15" viewBox="0 0 14 14" class="shrink-0 text-ink-faint"><circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4" fill="none" /><line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Search patients or jump to a page…"
          class="flex-1 border-0 text-[14px] text-ink-900 outline-none placeholder:text-ink-faint"
          @keydown="onKeydown"
        />
        <kbd class="rounded border border-line-control bg-surface-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-ink-faint2">Esc</kbd>
      </div>

      <div class="max-h-96 overflow-y-auto py-2">
        <template v-if="query.trim() && (searching || patients.length > 0)">
          <div class="px-3 py-1 text-[10.5px] font-[640] uppercase tracking-[.06em] text-ink-faint">Patients</div>
          <p v-if="searching" class="px-3 py-2 text-[13px] text-ink-faint">Searching…</p>
          <button
            v-for="p in patients"
            :key="p.id"
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle"
            @click="openPatient(p.id)"
          >
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctlSm bg-brand-tint text-[10px] font-bold text-brand">
              {{ (p.first_name[0] ?? '').toUpperCase() }}
            </span>
            {{ p.first_name }} {{ p.last_name }}
          </button>
        </template>

        <div class="px-3 py-1 text-[10.5px] font-[640] uppercase tracking-[.06em] text-ink-faint">Go to</div>
        <p v-if="filteredNav.length === 0" class="px-3 py-2 text-[13px] text-ink-faint">No matches.</p>
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
