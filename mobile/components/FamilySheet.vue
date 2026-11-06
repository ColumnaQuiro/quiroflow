<script setup lang="ts">
// Family accounts: whose app this is right now. Opened from the avatar on the
// home screen; the list is shared with the web portal
// (components/patient/FamilyList.vue).
const emit = defineEmits<{ close: [] }>()
const t = useT()
const { switchTo } = useFamily()

function choose(patientId: string) {
  switchTo(patientId)
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="family-sheet" @click.self="emit('close')">
    <div
      v-sheet-drag="() => emit('close')"
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Whose account', 'Ver la cuenta de')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <div>
        <p class="text-[17px] font-semibold text-ink-900">{{ t('Whose account', 'Ver la cuenta de') }}</p>
        <p class="mt-1 text-[13px] text-ink-muted">{{ t('Book, pay and check in for the people the clinic has linked to you.', 'Reserva, paga y avisa de tu llegada por las personas que la clínica ha vinculado contigo.') }}</p>
      </div>
      <PatientFamilyList @select="choose" />
    </div>
  </div>
</template>
