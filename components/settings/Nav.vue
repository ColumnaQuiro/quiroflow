<script setup lang="ts">
const route = useRoute()
const { can } = usePermission()
const t = useT()

interface NavItem {
  label: string
  to: string
  perm?: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const allGroups = computed<NavGroup[]>(() => [
  {
    label: t('General', 'General'),
    items: [{ label: t('Appearance', 'Apariencia'), to: '/settings/appearance' }],
  },
  {
    label: t('Clinic', 'Clínica'),
    items: [
      { label: t('Clinics', 'Clínicas'), to: '/settings/clinics', perm: 'clinic_config' },
      { label: t('Online Booking Hours', 'Horario de reserva online'), to: '/settings/clinics#online-booking', perm: 'clinic_config' },
      { label: t('Online Booking Settings', 'Configuración de reserva online'), to: '/settings/online-booking', perm: 'clinic_config' },
      { label: t('Team Members', 'Miembros del equipo'), to: '/settings/team', perm: 'team_admin' },
      { label: t('Practitioners', 'Profesionales'), to: '/settings/practitioners', perm: 'team_admin' },
      { label: t('Roles & Permissions', 'Roles y permisos'), to: '/settings/roles', perm: 'roles_admin' },
      { label: t('Appointment Types', 'Tipos de cita'), to: '/settings/appointment-types', perm: 'clinic_config' },
      { label: t('Scheduling Policies', 'Políticas de programación'), to: '/settings/reschedule-reasons', perm: 'clinic_config' },
      { label: t('Calendar Resources', 'Recursos de calendario'), to: '/settings/rooms', perm: 'clinic_config' },
      { label: t('Mobile App', 'App móvil'), to: '/settings/app', perm: 'clinic_config' },
      { label: t('Referral Sources', 'Fuentes de referencia'), to: '/settings/referral-sources', perm: 'clinic_config' },
      { label: t('Modalities', 'Modalidades'), to: '/settings/modalities', perm: 'clinic_config' },
      { label: t('New Patient Fields', 'Campos de nuevo paciente'), to: '/settings/new-patient-fields', perm: 'clinic_config' },
    ],
  },
  {
    label: t('Billing', 'Facturación'),
    items: [
      { label: t('Services & Products', 'Servicios y productos'), to: '/billing/services', perm: 'billing_config' },
      { label: t('Packages / Bonos', 'Paquetes / Bonos'), to: '/settings/packages', perm: 'billing_config' },
      { label: t('Memberships', 'Membresías'), to: '/settings/memberships', perm: 'billing_config' },
      { label: t('Payments (Stripe)', 'Pagos (Stripe)'), to: '/settings/payments', perm: 'billing_config' },
      { label: t('Payment Methods', 'Métodos de pago'), to: '/settings/payment-methods', perm: 'billing_config' },
      { label: t('Invoice Settings', 'Configuración de facturas'), to: '/settings/invoice-settings', perm: 'billing_config' },
      { label: t('Fiscal Data', 'Datos fiscales'), to: '/settings/fiscal-data', perm: 'billing_config' },
    ],
  },
  {
    label: t('Communication', 'Comunicación'),
    items: [
      { label: t('General', 'General'), to: '/settings/communications-general', perm: 'communication_config' },
      { label: t('WhatsApp', 'WhatsApp'), to: '/settings/whatsapp', perm: 'communication_config' },
      { label: t('Saved Replies', 'Respuestas guardadas'), to: '/settings/saved-replies', perm: 'communication_config' },
      { label: t('Docs', 'Documentos'), to: '/settings/docs', perm: 'communication_config' },
    ],
  },
  {
    label: t('Data', 'Datos'),
    items: [
      { label: t('Import Patients (CSV)', 'Importar pacientes (CSV)'), to: '/settings/import', perm: 'data_admin' },
      { label: t('Migrate Attachments', 'Migrar archivos adjuntos'), to: '/settings/migrate-attachments', perm: 'data_admin' },
      { label: t('Webhooks', 'Webhooks'), to: '/settings/webhooks', perm: 'data_admin' },
    ],
  },
])

const groups = computed(() =>
  allGroups.value.map((group) => ({ ...group, items: group.items.filter((item) => !item.perm || can(item.perm)) })).filter((group) => group.items.length > 0),
)

function isActive(to: string) {
  return route.path === to
}
</script>

<template>
  <nav class="w-[220px] shrink-0 space-y-5 bg-surface-sidebar p-3 print:hidden">
    <NuxtLink to="/settings" class="block px-2 text-[13px] font-semibold text-ink-900 hover:text-brand"> {{ t('Settings', 'Ajustes') }} </NuxtLink>
    <div v-for="group in groups" :key="group.label">
      <p class="px-2 text-[10.5px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ group.label }}</p>
      <div class="mt-1 space-y-0.5">
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="block h-8 rounded-ctlSm px-2 text-[13px] leading-8"
          :class="isActive(item.to) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-muted2 hover:bg-surface-subtle'"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>
