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

const arrived = computed(() => props.appointments.filter((a) => a.checked_in_at && !a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'))
const withPractitioner = computed(() => props.appointments.filter((a) => a.flow_with_practitioner_at && !a.flow_checkout_at && a.status === 'booked'))
const awaitingCheckout = computed(() => props.appointments.filter((a) => a.flow_checkout_at && a.status === 'booked'))
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <div class="rounded-lg border border-gray-200 bg-white p-3">
      <h3 class="text-sm font-semibold text-gray-700">Arrived</h3>
      <div class="mt-2 space-y-2">
        <div v-for="a in arrived" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
          <span class="truncate" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-xs text-indigo-600 hover:text-indigo-500" title="Move to With Practitioner" @click="emit('advance', a, 'flow_with_practitioner_at')">→</button>
        </div>
        <p v-if="arrived.length === 0" class="text-xs text-gray-300">—</p>
      </div>
    </div>
    <div class="rounded-lg border border-gray-200 bg-white p-3">
      <h3 class="text-sm font-semibold text-gray-700">With Practitioner</h3>
      <div class="mt-2 space-y-2">
        <div v-for="a in withPractitioner" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
          <span class="truncate" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-xs text-indigo-600 hover:text-indigo-500" title="Move to Awaiting Checkout" @click="emit('advance', a, 'flow_checkout_at')">→</button>
        </div>
        <p v-if="withPractitioner.length === 0" class="text-xs text-gray-300">—</p>
      </div>
    </div>
    <div class="rounded-lg border border-gray-200 bg-white p-3">
      <h3 class="text-sm font-semibold text-gray-700">Awaiting Checkout</h3>
      <div class="mt-2 space-y-2">
        <div v-for="a in awaitingCheckout" :key="a.id" class="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1.5 text-sm">
          <span class="truncate" :class="{ 'blur-sm select-none': privacyMode }">{{ a.patients?.first_name }} {{ a.patients?.last_name }}</span>
          <button type="button" class="shrink-0 text-xs font-medium text-green-600 hover:text-green-500" title="Complete visit" @click="emit('complete', a)">Complete</button>
        </div>
        <p v-if="awaitingCheckout.length === 0" class="text-xs text-gray-300">—</p>
      </div>
    </div>
  </div>
</template>
