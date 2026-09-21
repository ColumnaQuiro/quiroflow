<script setup lang="ts">
defineProps<{ email: string }>()
const t = useT()
</script>

<template>
  <SubscriptionCard tone="subtle">
    <p class="text-[13.5px] font-semibold text-ink-900">{{ t('A question about your bill?', '¿Alguna duda con tu factura?') }}</p>
    <p class="mt-1.5 text-[12.5px] leading-[1.5] text-ink-muted">
      {{ t('Write to', 'Escríbenos a') }}
      <a :href="`mailto:${email}`" class="font-semibold text-brand-text hover:text-brand-hover">{{ email }}</a>
      {{ t('and a person answers, in English or Spanish.', 'y te responde una persona, en inglés o en español.') }}
    </p>
  </SubscriptionCard>
</template>
