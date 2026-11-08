<script setup lang="ts">
// The three ways a Growth page can have nothing to show: the person's role
// does not reach Growth, the clinic's plan does not include it, or the load
// failed. Each page used to write these as a bare centred paragraph -- the
// error one in red -- which reads as a screen that broke rather than one with
// a reason, and they had drifted apart between the four pages. UiEmptyState
// with the reason as its title, and the one thing to do about it.
const props = defineProps<{
  kind: 'no-access' | 'not-in-tier' | 'error'
  /** The sentence to show: the page's own words for its tier, or the load error. */
  title?: string
}>()
const emit = defineEmits<{ retry: [] }>()

const t = useT()

const heading = computed(() => props.title ?? t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.'))
</script>

<template>
  <UiEmptyState :title="heading">
    <template #icon>
      <svg v-if="kind === 'error'" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 6.5v4.2M10 13.4v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4" />
      </svg>
      <svg v-else-if="kind === 'no-access'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      <!-- Growth's own mark: a rising line. -->
      <svg v-else width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 14l4.5-4.5 3 3L17 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M12.5 6H17v4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </template>
    <template v-if="kind !== 'no-access'" #actions>
      <UiBtn v-if="kind === 'error'" variant="primary" @click="emit('retry')">{{ t('Try again', 'Reintentar') }}</UiBtn>
      <NuxtLink
        v-else
        to="/growth"
        class="inline-flex h-9 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11"
      >{{ t('See what Growth adds', 'Ver qué añade Growth') }}</NuxtLink>
    </template>
  </UiEmptyState>
</template>
