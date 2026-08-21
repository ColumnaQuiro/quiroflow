<script setup lang="ts">
const props = defineProps<{ practitionerId?: string }>()

const supabase = useSupabaseClient()
const loading = ref(true)
const total = ref(0)

async function load() {
  loading.value = true
  let query = supabase.from('patients').select('id', { count: 'exact', head: true })
  if (props.practitionerId) query = query.eq('default_practitioner_id', props.practitionerId)
  const { count } = await query
  total.value = count ?? 0
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">Loading…</div>
  <p v-else class="font-mono text-[27px] leading-none text-ink-900">{{ total }}</p>
</template>
