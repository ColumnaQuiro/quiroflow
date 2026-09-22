<script setup lang="ts">
// Docs and files, which were two tabs and are one.
//
// The split was a technical one, not a human one: "Docs" are consent forms
// and reports the clinic generates and the patient signs, "Files" are
// anything uploaded -- an X-ray, a GP letter, a photo. Staff looking for
// "that thing about this patient" had to guess which of the two it had
// been filed under, and the answer was frequently the other one.
//
// They stay as two groups, because signing a consent form and uploading a
// scan are genuinely different actions with different controls. But they
// are on one screen, so finding something no longer requires knowing in
// advance where it went.
defineProps<{ patientId: string }>()

const t = useT()
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- The headings are sr-only because both panels already title
         themselves on screen -- printing a second "Files" above FilesTab's
         own said it twice. They stay in the markup so the two groups are
         still announced as named regions rather than one undifferentiated
         run of controls. -->
    <section aria-labelledby="attachments-docs-heading">
      <h2 id="attachments-docs-heading" class="sr-only">{{ t('Documents', 'Documentos') }}</h2>
      <PatientsDocsTab :patient-id="patientId" />
    </section>

    <section aria-labelledby="attachments-files-heading">
      <h2 id="attachments-files-heading" class="sr-only">{{ t('Files', 'Archivos') }}</h2>
      <PatientsFilesTab :patient-id="patientId" />
    </section>
  </div>
</template>
