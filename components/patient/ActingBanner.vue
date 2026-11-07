<script setup lang="ts">
// Said on every screen while the login is showing somebody else's record, so
// nobody books, pays or reads thinking it is their own: "Estás viendo la
// cuenta de Lucas", with the way back.
const t = useT()
const { active, me, actingForOther, switchTo } = useFamily()
</script>

<template>
  <div
    v-if="actingForOther && active"
    class="flex items-center gap-3 border-b border-info-border bg-info-bg px-4 py-2.5"
    role="status"
    data-cy="acting-banner"
  >
    <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-info-text">{{ personInitials(active) }}</span>
    <p class="min-w-0 flex-1 text-[13px] leading-snug text-info-text">
      {{ t(`You are viewing ${active.firstName}'s account`, `Estás viendo la cuenta de ${active.firstName}`) }}
      <span v-if="active.access === 'admin'" class="block text-[12px] opacity-80">{{ t('Only visits, bookings and payments', 'Solo citas, reservas y pagos') }}</span>
    </p>
    <button
      v-if="me"
      type="button"
      class="shrink-0 rounded-ctlSm px-2 py-1.5 text-[12.5px] font-semibold text-info-text underline-offset-2 hover:underline"
      data-cy="acting-banner-back"
      @click="switchTo(me.patientId)"
    >
      {{ t('Back to mine', 'Volver a la mía') }}
    </button>
  </div>
</template>
