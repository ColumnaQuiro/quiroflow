<script setup lang="ts">
// Blind Spot (punto ciego) on the web: the header, and the test itself in
// components/blindspot/Test.vue, which the staff app shows too
// (mobile/pages/patients/blind-spot/[id].vue).
const t = useT()
const route = useRoute()
const supabase = useSupabaseClient()
const patientId = route.params.id as string

const patientName = ref('')
onMounted(async () => {
  const { data: p } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
  patientName.value = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="patientName ? t(`Blind spot · ${patientName}`, `Punto ciego · ${patientName}`) : t('Blind spot', 'Punto ciego')"
      :meta="t('A functional measure for follow-up. Not a diagnostic test.', 'Medición funcional para el seguimiento. No es una prueba diagnóstica.')"
    >
      <NuxtLink
        :to="`/patients/${patientId}?tab=blind-spot`"
        class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-ctl border border-transparent px-3.5 text-[13px] font-medium text-ink-muted2 outline-none hover:bg-surface-subtle focus-visible:shadow-focus touch:h-11"
      >
        {{ t('Cancel', 'Cancelar') }}
      </NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <BlindspotTest :patient-id="patientId" />
    </div>
  </div>
</template>
