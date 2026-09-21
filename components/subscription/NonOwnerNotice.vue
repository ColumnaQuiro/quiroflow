<script setup lang="ts">
// A team member who is not the owner. The component is the courtesy, not the
// permission -- /api/billing/* already refuses them server-side, which is what
// actually protects the data.
defineProps<{ ownerName: string | null; supportEmail: string }>()
const t = useT()
</script>

<template>
  <SubscriptionCard>
    <div class="flex flex-col items-center px-4 py-6 text-center lg:py-8">
      <span class="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-line bg-surface-subtle">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[18px] w-[18px] text-ink-muted">
          <rect x="3.6" y="7.4" width="10.8" height="7.2" rx="2" stroke="currentColor" stroke-width="1.4" />
          <path d="M6.2 7.4V5.4a2.8 2.8 0 0 1 5.6 0v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <h2 class="mt-3.5 text-[17px] font-semibold text-ink-900">
        {{ t('Billing is visible to the account owner', 'La facturación solo la ve la persona propietaria') }}
      </h2>
      <p class="mx-auto mt-2 max-w-[430px] text-[13.5px] leading-[1.55] text-ink-muted">
        <template v-if="ownerName">{{ t(`${ownerName} owns this account.`, `${ownerName} es la persona propietaria de esta cuenta.`) }} </template>
        {{
          t(
            'Ask them to change the plan or update the card — nothing on this page affects your calendar, your patients or your notes.',
            'Pídele que cambie el plan o actualice la tarjeta: nada de esta página afecta a tu agenda, tus pacientes ni tus notas.',
          )
        }}
      </p>
      <div class="mt-4 flex flex-col items-center gap-3 lg:flex-row">
        <NuxtLink
          to="/calendar"
          class="flex h-11 items-center justify-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
        >
          {{ t('Back to calendar', 'Volver a la agenda') }}
        </NuxtLink>
        <span class="text-[12.5px] text-ink-muted">
          <a :href="`mailto:${supportEmail}`" class="font-semibold text-brand-text hover:text-brand-hover">{{ supportEmail }}</a>
        </span>
      </div>
    </div>
  </SubscriptionCard>
</template>
