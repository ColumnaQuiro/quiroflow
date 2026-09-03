<script setup lang="ts">
interface FlowAppointment {
  id: string
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
  status: string
  patients: { first_name: string; last_name: string | null } | null
}

const props = defineProps<{ appointments: FlowAppointment[]; privacyMode?: boolean }>()
const emit = defineEmits<{ advance: [appt: FlowAppointment, field: 'flow_with_practitioner_at' | 'flow_checkout_at']; complete: [appt: FlowAppointment] }>()
const t = useT()

const arrived = computed(() => props.appointments.filter((a) => a.checked_in_at && !a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'))
const withPractitioner = computed(() => props.appointments.filter((a) => a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'))
const awaitingCheckout = computed(() => props.appointments.filter((a) => a.flow_checkout_at && a.status === 'booked'))
</script>

<template>
  <div class="space-y-3">
    <div class="rounded-card border border-line bg-surface p-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12.5px] font-[640] text-ink-700">{{ t('Arrived', 'Llegados') }}</h3>
        <span class="rounded-pill bg-chip-bg px-1.5 py-0.5 text-[11px] font-medium text-chip-text">{{ arrived.length }}</span>
      </div>
      <div class="mt-2 space-y-1.5">
        <div v-for="a in arrived" :key="a.id" class="flex items-center justify-between gap-2 rounded-ctlSm border border-line-row px-2 py-1.5 text-[13px]">
          <span class="truncate text-ink-700" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-[12px] font-medium text-brand-text hover:text-brand-hover" :title="t('Move to With Practitioner', 'Mover a Con el profesional')" @click="emit('advance', a, 'flow_with_practitioner_at')">→</button>
        </div>
        <p v-if="arrived.length === 0" class="text-[12px] text-ink-faint">—</p>
      </div>
    </div>
    <div class="rounded-card border border-line bg-surface p-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12.5px] font-[640] text-ink-700">{{ t('In Session', 'En consulta') }}</h3>
        <span class="rounded-pill bg-chip-bg px-1.5 py-0.5 text-[11px] font-medium text-chip-text">{{ withPractitioner.length }}</span>
      </div>
      <div class="mt-2 space-y-1.5">
        <div v-for="a in withPractitioner" :key="a.id" class="flex items-center justify-between gap-2 rounded-ctlSm border border-line-row px-2 py-1.5 text-[13px]">
          <span class="truncate text-ink-700" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-[12px] font-medium text-brand-text hover:text-brand-hover" :title="t('Move to Awaiting Checkout', 'Mover a Esperando salida')" @click="emit('advance', a, 'flow_checkout_at')">→</button>
        </div>
        <p v-if="withPractitioner.length === 0" class="text-[12px] text-ink-faint">—</p>
      </div>
    </div>
    <div class="rounded-card border border-line bg-surface p-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12.5px] font-[640] text-ink-700">{{ t('Awaiting Checkout', 'Esperando salida') }}</h3>
        <span class="rounded-pill bg-chip-bg px-1.5 py-0.5 text-[11px] font-medium text-chip-text">{{ awaitingCheckout.length }}</span>
      </div>
      <div class="mt-2 space-y-1.5">
        <div v-for="a in awaitingCheckout" :key="a.id" class="flex items-center justify-between gap-2 rounded-ctlSm border border-line-row px-2 py-1.5 text-[13px]">
          <span class="truncate text-ink-700" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-[12px] font-medium text-success-text hover:text-success-deep" :title="t('Complete visit', 'Completar visita')" @click="emit('complete', a)">{{ t('Complete', 'Completar') }}</button>
        </div>
        <p v-if="awaitingCheckout.length === 0" class="text-[12px] text-ink-faint">—</p>
      </div>
    </div>
  </div>
</template>
