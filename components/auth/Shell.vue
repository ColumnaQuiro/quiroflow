<script setup lang="ts">
// The frame the password pages share (forgot / reset). They serve staff and
// patients alike, told apart by ?portal=1, so the header and the preview
// follow whichever side sent them: the clinic and the patient's view for a
// patient, QuiroFlow and the calendar for staff.
const props = defineProps<{ portal: boolean }>()
const t = useT()

// Quietly: a stored code that no longer resolves just leaves the generic
// "Patient portal" header.
const clinic = useClinicCode()
onMounted(async () => {
  if (!props.portal) return
  clinic.prefill()
  if (!clinic.code.value) return
  try {
    await clinic.resolve()
  } catch {
    /* generic header */
  }
})
</script>

<template>
  <OnboardingLayout :trust="false">
    <template v-if="portal" #brand>
      <AuthClinicBrand :name="clinic.clinicName.value || undefined" />
    </template>
    <template #brand-aside>
      <AuthLangToggle />
    </template>

    <template #heading>
      <slot name="heading" />
    </template>
    <template #form>
      <slot name="form" />
    </template>


    <template #preview>
      <AuthPreviewPortal v-if="portal" :clinic-name="clinic.clinicName.value || undefined" />
      <OnboardingPreviewCalendar
        v-else
        eyebrow="QuiroFlow"
        :title="t('Your clinic, in one place', 'Tu clínica, en un solo sitio')"
        :body="
          t(
            'Calendar, patient records, reminders and invoicing, for every clinic in your practice.',
            'Agenda, historiales, recordatorios y facturación, para todas las clínicas de tu consulta.',
          )
        "
      />
    </template>
  </OnboardingLayout>
</template>
