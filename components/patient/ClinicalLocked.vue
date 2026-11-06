<script setup lang="ts">
// A section a 'admin' family link does not reach (patient_managers.access):
// the clinic gave this login the person's visits and payments, not their
// documents, exercises, progress or messages. The database returns nothing
// for them anyway; this says why instead of showing an empty list.
const t = useT()
const { active, me, switchTo } = useFamily()
</script>

<template>
  <div class="rounded-card border border-line bg-surface px-5 py-8 text-center shadow-card" data-cy="clinical-locked">
    <p class="text-[14px] font-medium text-ink-900">{{ t('Not shared with you', 'No compartido contigo') }}</p>
    <p class="mx-auto mt-1.5 max-w-sm text-[13px] text-ink-muted">
      {{ t(
        `The clinic lets you manage ${active?.firstName ?? 'this person'}'s visits and payments. Their documents, exercises and messages stay private to them.`,
        `La clínica te permite gestionar las citas y los pagos de ${active?.firstName ?? 'esta persona'}. Sus documentos, ejercicios y mensajes son solo suyos.`,
      ) }}
    </p>
    <button v-if="me" type="button" class="mt-4 text-[13px] font-semibold text-brand-text" @click="switchTo(me.patientId)">
      {{ t('Back to my account', 'Volver a mi cuenta') }}
    </button>
  </div>
</template>
