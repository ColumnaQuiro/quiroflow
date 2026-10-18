<script setup lang="ts">
// A new posture assessment from the staff app: the phone's or iPad's camera
// takes each photo in the room, through components/posture/Capture.vue -- the
// web's own capture, pose model and measurements -- so an assessment taken
// here is the same row the web shows and compares.
definePageMeta({ layout: 'practitioner' })

const t = useT()
const route = useRoute()
const router = useRouter()
const patientId = route.params.id as string
const { context, loading: contextLoading, can } = usePractitionerContext()
const allowed = computed(() => can('visit_notes_access'))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="staff-posture">
    <AppPageHeader :title="t('New posture assessment', 'Nueva valoración postural')" back @back="router.back()" />
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3">
      <p class="mb-3 text-[12.5px] text-ink-muted">{{ t('Estimates from photos, to document and explain — not a diagnosis.', 'Estimaciones a partir de fotos, para documentar y explicar — no para diagnosticar.') }}</p>
      <p v-if="!contextLoading && !allowed" class="rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('Your role does not include clinical records.', 'Tu rol no incluye la historia clínica.') }}</p>
      <PostureCapture
        v-else-if="context"
        :patient-id="patientId"
        :account-id="context.accountId"
        :team-member-id="context.teamMemberId"
        @saved="router.replace(`/patients/${patientId}`)"
      />
    </div>
  </div>
</template>
