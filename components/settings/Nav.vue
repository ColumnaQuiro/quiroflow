<script setup lang="ts">
const route = useRoute()

interface NavItem {
  label: string
  to: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: 'Clinic',
    items: [
      { label: 'Clinics', to: '/settings/clinics' },
      { label: 'Team Members', to: '/settings/team' },
      { label: 'Practitioners', to: '/settings/practitioners' },
      { label: 'Appointment Types', to: '/settings/appointment-types' },
      { label: 'Calendar Resources', to: '/settings/rooms' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { label: 'Services & Products', to: '/billing/services' },
      { label: 'Packages / Bonos', to: '/settings/packages' },
      { label: 'Memberships', to: '/settings/memberships' },
      { label: 'Payments (Stripe)', to: '/settings/payments' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'WhatsApp', to: '/settings/whatsapp' },
      { label: 'Docs', to: '/settings/docs' },
    ],
  },
  {
    label: 'Data',
    items: [
      { label: 'Import Patients (CSV)', to: '/settings/import' },
      { label: 'Migrate Attachments', to: '/settings/migrate-attachments' },
      { label: 'Webhooks', to: '/settings/webhooks' },
    ],
  },
]

function isActive(to: string) {
  return route.path === to
}
</script>

<template>
  <nav class="w-56 shrink-0 space-y-6 print:hidden">
    <NuxtLink to="/settings" class="block text-sm font-semibold text-gray-900 hover:text-indigo-600"> Settings </NuxtLink>
    <div v-for="group in groups" :key="group.label">
      <p class="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{{ group.label }}</p>
      <div class="mt-1 space-y-0.5">
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="block rounded-md px-3 py-1.5 text-sm"
          :class="isActive(item.to) ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
