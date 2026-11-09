<script setup lang="ts">
// A new posture assessment, on the web. The capture itself is
// components/posture/Capture.vue, shared with the staff app.
const t = useT()
const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const patientId = route.params.id as string

const patientName = ref('')
onMounted(async () => {
  const { data: p } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
  patientName.value = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- "Postura · " with nothing after it until the name has loaded. -->
    <PageHeader :title="patientName ? t(`Posture · ${patientName}`, `Postura · ${patientName}`) : t('Posture', 'Postura')" :meta="t('Estimates from photos, to document and explain — not a diagnosis.', 'Estimaciones a partir de fotos, para documentar y explicar — no para diagnosticar.')">
      <NuxtLink
        :to="`/patients/${patientId}?tab=progress`"
        class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-ctl border border-transparent px-3.5 text-[13px] font-medium text-ink-muted2 outline-none hover:bg-surface-subtle focus-visible:shadow-focus touch:h-11"
      >
        {{ t('Cancel', 'Cancelar') }}
      </NuxtLink>
    </PageHeader>
    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <div class="mx-auto max-w-[1180px]">
        <PostureCapture
          v-if="store.accountId"
          :patient-id="patientId"
          :account-id="store.accountId"
          :team-member-id="store.teamMember?.id ?? null"
          @saved="navigateTo(`/patients/${patientId}?tab=progress`)"
        />
      </div>
    </div>
  </div>
</template>
