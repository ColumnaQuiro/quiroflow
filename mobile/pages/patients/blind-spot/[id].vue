<script setup lang="ts">
// A new Blind Spot (punto ciego) test from the staff app, through
// components/blindspot/Test.vue -- the web's own test, so a test taken here is
// the same row the web shows and compares. It needs a wide screen (an iPad,
// or an Android tablet); on a phone the set-up says so. Saving lands back on
// the record's Punto ciego tab.
definePageMeta({ layout: 'practitioner' })

const t = useT()
const route = useRoute()
const router = useRouter()
const supabase = useSupabaseClient()
const patientId = route.params.id as string
const { context, loading: contextLoading } = usePractitionerContext()

const patientName = ref('')
onMounted(async () => {
  const { data: p } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
  patientName.value = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="staff-blind-spot">
    <AppPageHeader
      :title="patientName ? t(`Blind spot · ${patientName}`, `Punto ciego · ${patientName}`) : t('Blind spot', 'Punto ciego')"
      :sub="t('A functional measure for follow-up. Not a diagnostic test.', 'Medición funcional para el seguimiento. No es una prueba diagnóstica.')"
      back
      @back="router.back()"
    />
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3">
      <BlindspotTest v-if="context && !contextLoading" :patient-id="patientId" />
    </div>
  </div>
</template>
