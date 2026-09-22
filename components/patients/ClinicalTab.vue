<script setup lang="ts">
// Everything clinical about this patient, on one surface.
//
// These four panels used to be split across two places: the sticky note,
// the flags and the care-plan stats lived in the 280px rail -- visible on
// every tab, including Billing, where they are noise -- while the visit
// notes had a tab of their own. A practitioner reading a patient up before
// a session wants the complaint, the diagnosis, where they are in the plan
// and what happened last time, together and in that order. So they are
// together, and the rail is gone.
//
// The note comes first because it is the thing the front desk writes for
// whoever opens the record next, and it is the one panel that is worth
// seeing before you have read anything else.
defineProps<{ patientId: string }>()

const t = useT()
</script>

<template>
  <div class="flex flex-col gap-4">
    <PatientsStickyNotePanel :patient-id="patientId" />

    <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <section aria-labelledby="clinical-notes-heading">
          <h2 id="clinical-notes-heading" class="sr-only">{{ t('Visit notes', 'Notas de visita') }}</h2>
          <PatientsVisitNotesTab :patient-id="patientId" />
        </section>
      </div>

      <div class="flex w-full shrink-0 flex-col gap-4 xl:w-[320px]">
        <PatientsFlagsPanel :patient-id="patientId" />
        <PatientsPhaseStats :patient-id="patientId" />
      </div>
    </div>
  </div>
</template>
