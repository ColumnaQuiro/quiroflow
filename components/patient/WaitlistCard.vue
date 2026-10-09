<script setup lang="ts">
// "¿Te vendría bien antes?": join or leave the clinic's waitlist, in the app
// and the portal. Shown where the clinic lets patients book from the app
// (join_my_waitlist checks the same), at the next visit's clinic -- or the
// only clinic, with nothing booked.
const props = defineProps<{ clinicId: string | null; hasNextVisit: boolean }>()

const t = useT()
const { entries, busy, error, join, leave } = usePatientWaitlist()
const mine = computed(() => entries.value.find((e) => e.clinic_id === props.clinicId) ?? null)
</script>

<template>
  <section v-if="clinicId" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-waitlist">
    <template v-if="mine">
      <p class="text-[13.5px] font-medium text-ink-900">{{ t("You're on the waitlist", 'Estás en la lista de espera') }}</p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted">
        {{ mine.status === 'offered'
          ? t('The clinic has offered you a slot: check your messages.', 'La clínica te ha ofrecido un hueco: revisa tus mensajes.')
          : t("We'll let you know if an earlier slot frees up.", 'Te avisaremos si queda libre un hueco antes.') }}
      </p>
      <button v-if="mine.status === 'waiting'" type="button" class="mt-2 text-[12.5px] font-medium text-danger-text" :disabled="busy" data-cy="patient-waitlist-leave" @click="leave(mine.id)">
        {{ t('Leave the waitlist', 'Salir de la lista de espera') }}
      </button>
    </template>
    <template v-else>
      <p class="text-[13.5px] font-medium text-ink-900">{{ hasNextVisit ? t('Would earlier suit you?', '¿Te vendría bien antes?') : t('No slot that suits you?', '¿No encuentras hueco?') }}</p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ t("Join the waitlist and we'll let you know if a slot frees up.", 'Apúntate a la lista de espera y te avisaremos si queda un hueco libre.') }}</p>
      <button type="button" class="mt-2 min-h-9 rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-white" :disabled="busy" data-cy="patient-waitlist-join" @click="join(clinicId)">
        {{ busy ? t('Adding you…', 'Apuntándote…') : t('Let me know', 'Avísame') }}
      </button>
    </template>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
  </section>
</template>
