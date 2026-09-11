<script setup lang="ts">
// One shape for every importer's header, because they had drifted into fifteen
// different ones: Patients and Appointments were a single terse line about
// exporting a CSV, Care Plans and Payments mentioned the preview and re-run
// safety, Sticky Notes mentioned re-run but not the preview, and Packages /
// Bonos had four emoji callouts nobody else had. Whether a step was safe to run
// twice depended on which screen you happened to be on.
//
// `lead` says what the step brings across, in one sentence. `notes` are the
// rules that change what someone does -- what gets written, what is skipped,
// what it will refuse to do -- and every importer states the same basics so
// they can be trusted without reading the source.
defineProps<{
  lead: string
  notes?: { title: string; body: string }[]
}>()
</script>

<template>
  <div class="space-y-3">
    <p class="max-w-3xl text-[13px] leading-relaxed text-ink-muted2">{{ lead }}</p>
    <div v-if="notes?.length" class="space-y-2">
      <div v-for="note in notes" :key="note.title" class="flex gap-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-3">
        <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint3" />
        <p class="text-[12.5px] leading-relaxed text-ink-600">
          <span class="font-medium text-ink-700">{{ note.title }}</span>
          {{ note.body }}
        </p>
      </div>
    </div>
  </div>
</template>
