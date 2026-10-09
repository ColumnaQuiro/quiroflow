<script setup lang="ts">
import { devicePlatform, directionsUrl, telUrl } from '../../utils/clinicLinks'

// "Tu clínica": each of the patient's clinics, where it is and how to reach
// it -- in the app and the portal. Messages is the app's or the portal's own
// chat with the clinic, passed in because the route differs.
defineProps<{ messagesTo: string }>()

const t = useT()
const { clinics } = usePatientClinics()
const platform = import.meta.client ? devicePlatform(window as never) : 'web'
function openDirections(url: string) {
  openWhenReady(async () => url)
}
</script>

<template>
  <section v-for="c in clinics" :key="c.id" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-clinic">
    <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your clinic', 'Tu clínica') }}</p>
    <p class="mt-1 text-[14.5px] font-semibold text-ink-900">{{ c.name }}</p>
    <p v-if="c.address" class="mt-0.5 text-[12.5px] text-ink-muted">{{ c.address }}</p>
    <div class="mt-2.5 flex flex-wrap gap-2">
      <a v-if="telUrl(c.phone)" :href="telUrl(c.phone)!" class="flex min-h-9 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle" data-cy="patient-clinic-call">{{ t('Call', 'Llamar') }}</a>
      <button v-if="directionsUrl(c, platform)" type="button" class="min-h-9 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle" data-cy="patient-clinic-directions" @click="openDirections(directionsUrl(c, platform)!)">{{ t('Directions', 'Cómo llegar') }}</button>
      <NuxtLink :to="messagesTo" class="flex min-h-9 items-center rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle">{{ t('Message', 'Escribir') }}</NuxtLink>
    </div>
  </section>
</template>
