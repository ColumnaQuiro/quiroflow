<script setup lang="ts">
const route = useRoute()
const { can } = usePermission()

interface NavItem {
  label: string
  to: string
  perm?: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const allGroups: NavGroup[] = [
  {
    label: 'General',
    items: [{ label: 'Appearance', to: '/settings/appearance' }],
  },
  {
    label: 'Clinic',
    items: [
      { label: 'Clinics', to: '/settings/clinics', perm: 'clinic_config' },
      { label: 'Online Booking', to: '/settings/clinics#online-booking', perm: 'clinic_config' },
      { label: 'Team Members', to: '/settings/team', perm: 'team_admin' },
      { label: 'Practitioners', to: '/settings/practitioners', perm: 'team_admin' },
      { label: 'Roles & Permissions', to: '/settings/roles', perm: 'roles_admin' },
      { label: 'Appointment Types', to: '/settings/appointment-types', perm: 'clinic_config' },
      { label: 'Scheduling Policies', to: '/settings/reschedule-reasons', perm: 'clinic_config' },
      { label: 'Calendar Resources', to: '/settings/rooms', perm: 'clinic_config' },
      { label: 'Mobile App', to: '/settings/app', perm: 'clinic_config' },
      { label: 'Referral Sources', to: '/settings/referral-sources', perm: 'clinic_config' },
      { label: 'Modalities', to: '/settings/modalities', perm: 'clinic_config' },
      { label: 'New Patient Fields', to: '/settings/new-patient-fields', perm: 'clinic_config' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { label: 'Services & Products', to: '/billing/services', perm: 'billing_config' },
      { label: 'Packages / Bonos', to: '/settings/packages', perm: 'billing_config' },
      { label: 'Memberships', to: '/settings/memberships', perm: 'billing_config' },
      { label: 'Payments (Stripe)', to: '/settings/payments', perm: 'billing_config' },
      { label: 'Payment Methods', to: '/settings/payment-methods', perm: 'billing_config' },
      { label: 'Invoice Settings', to: '/settings/invoice-settings', perm: 'billing_config' },
      { label: 'Fiscal Data', to: '/settings/fiscal-data', perm: 'billing_config' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'WhatsApp', to: '/settings/whatsapp', perm: 'communication_config' },
      { label: 'Saved Replies', to: '/settings/saved-replies', perm: 'communication_config' },
      { label: 'Docs', to: '/settings/docs', perm: 'communication_config' },
    ],
  },
  {
    label: 'Data',
    items: [
      { label: 'Import Patients (CSV)', to: '/settings/import', perm: 'data_admin' },
      { label: 'Migrate Attachments', to: '/settings/migrate-attachments', perm: 'data_admin' },
      { label: 'Webhooks', to: '/settings/webhooks', perm: 'data_admin' },
    ],
  },
]

const groups = computed(() =>
  allGroups.map((group) => ({ ...group, items: group.items.filter((item) => !item.perm || can(item.perm)) })).filter((group) => group.items.length > 0),
)

function isActive(to: string) {
  return route.path === to
}
</script>

<template>
  <nav class="w-[220px] shrink-0 space-y-5 bg-surface-sidebar p-3 print:hidden">
    <NuxtLink to="/settings" class="block px-2 text-[13px] font-semibold text-ink-900 hover:text-brand"> Settings </NuxtLink>
    <div v-for="group in groups" :key="group.label">
      <p class="px-2 text-[10.5px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ group.label }}</p>
      <div class="mt-1 space-y-0.5">
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="block h-8 rounded-ctlSm px-2 text-[13px] leading-8"
          :class="isActive(item.to) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-muted2 hover:bg-[#EFF0F4]'"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
