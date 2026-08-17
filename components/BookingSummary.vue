<script setup lang="ts">
defineProps<{
  clinic: { name: string; address: string | null } | null
  appointmentType: { name: string; default_price_cents: number } | null
  teamMember: { full_name: string } | null
  slot: Date | null
  formatPrice: (cents: number) => string
}>()
</script>

<template>
  <div class="h-fit rounded-lg border border-gray-200 bg-white p-5">
    <h3 class="text-sm font-semibold text-gray-900">Resumen de la reserva</h3>
    <div class="mt-3 space-y-3 text-sm">
      <div v-if="clinic">
        <p class="font-medium text-gray-900">{{ clinic.name }}</p>
        <p v-if="clinic.address" class="text-gray-500">{{ clinic.address }}</p>
      </div>
      <div v-if="appointmentType" class="flex items-center justify-between border-t border-gray-100 pt-3">
        <span class="text-gray-700">{{ appointmentType.name }}</span>
        <span class="font-medium text-gray-900">{{ formatPrice(appointmentType.default_price_cents) }}</span>
      </div>
      <div v-if="teamMember" class="border-t border-gray-100 pt-3 text-gray-700">
        {{ teamMember.full_name }}
      </div>
      <div v-if="slot" class="border-t border-gray-100 pt-3 text-gray-700">
        {{ slot.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) }}
        · {{ slot.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }}
      </div>
    </div>
  </div>
</template>
