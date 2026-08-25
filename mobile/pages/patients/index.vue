<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Patient {
  id: string
  first_name: string
  last_name: string | null
  status: string
}

const supabase = useSupabaseClient()
const search = ref('')
const patients = ref<Patient[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  let query = supabase.from('patients').select('id, first_name, last_name, status').eq('status', 'active').order('first_name').limit(100)
  const term = search.value.trim()
  if (term) query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
  const { data } = await query
  patients.value = data ?? []
  loading.value = false
}
onMounted(load)

let debounceTimer: ReturnType<typeof setTimeout>
watch(search, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(load, 300)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-line bg-surface px-4 py-3">
      <h1 class="mb-2 text-[17px] font-semibold text-ink-900">Patients</h1>
      <input
        v-model="search"
        type="search"
        placeholder="Search patients…"
        class="w-full rounded-ctl border border-line-control bg-surface-page px-3 py-2 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
      />
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="patients.length === 0" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">No patients found.</p>

    <div v-else class="flex-1 overflow-y-auto">
      <NuxtLink
        v-for="p in patients"
        :key="p.id"
        :to="`/patients/${p.id}`"
        class="flex items-center gap-3 border-b border-line-row px-4 py-3 active:bg-surface-subtle"
      >
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand-text">
          {{ p.first_name.slice(0, 1).toUpperCase() }}{{ (p.last_name ?? '').slice(0, 1).toUpperCase() }}
        </span>
        <p class="truncate text-[14px] font-[560] text-ink-900">{{ p.first_name }} {{ p.last_name ?? '' }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
