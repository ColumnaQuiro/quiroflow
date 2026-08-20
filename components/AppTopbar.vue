<script setup lang="ts">
interface PatientResult { id: string; first_name: string; last_name: string | null }

const supabase = useSupabaseClient()
const store = useAccountStore()
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function onDocumentClick(e: MouseEvent) {
  if (menuOpen.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

const query = ref('')
const results = ref<PatientResult[]>([])
const searching = ref(false)
const showResults = ref(false)
let searchTimer: ReturnType<typeof setTimeout>

watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    results.value = []
    showResults.value = false
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .order('first_name')
      .limit(8)
    results.value = data ?? []
    showResults.value = true
    searching.value = false
  }, 250)
})

async function selectPatient(id: string) {
  showResults.value = false
  query.value = ''
  await navigateTo(`/patients/${id}`)
}

const initials = computed(() => {
  const name = store.teamMember?.full_name ?? ''
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
})

async function signOut() {
  await supabase.auth.signOut()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <header class="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 print:hidden">
    <div class="flex flex-1 items-center gap-3">
      <div class="relative w-72 max-w-full">
        <svg class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="Search for patients"
          class="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @focus="showResults = query.trim().length > 0"
          @blur="showResults = false"
        />
        <ul
          v-if="showResults"
          class="absolute left-0 z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <li v-if="searching" class="px-3 py-2 text-sm text-gray-400">Searching…</li>
          <template v-else>
            <li v-if="results.length === 0" class="px-3 py-2 text-sm text-gray-400">No patients found</li>
            <button
              v-for="p in results"
              :key="p.id"
              type="button"
              class="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              @mousedown.prevent="selectPatient(p.id)"
            >
              {{ p.first_name }} {{ p.last_name }}
            </button>
          </template>
        </ul>
      </div>

      <select
        v-if="store.clinics.length > 0"
        v-model="store.currentClinicId"
        class="rounded-md border border-gray-300 py-1.5 pl-2 pr-7 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option v-for="clinic in store.clinics" :key="clinic.id" :value="clinic.id">
          {{ clinic.name }}
        </option>
      </select>
    </div>

    <div ref="menuRef" class="relative">
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-medium text-white"
        @click="menuOpen = !menuOpen"
      >
        {{ initials }}
      </button>
      <div
        v-if="menuOpen"
        class="absolute right-0 z-10 mt-2 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        @click="menuOpen = false"
      >
        <div class="border-b border-gray-100 px-3 py-2">
          <p class="truncate text-sm font-medium text-gray-900">{{ store.teamMember?.full_name }}</p>
          <p class="text-xs text-gray-500">{{ store.accountName }}</p>
        </div>
        <NuxtLink to="/account" class="block w-full px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50">
          Account Settings
        </NuxtLink>
        <button type="button" class="block w-full px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50" @click="signOut">
          Sign out
        </button>
      </div>
    </div>
  </header>
</template>
