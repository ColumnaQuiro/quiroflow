<script setup lang="ts">
const route = useRoute()
const { can } = usePermission()
const store = useAccountStore()
const t = useT()

interface NavItem {
  label: string
  to: string
  perm?: string
  /** The company's own settings (VeriFactu): owners only, whatever the role grants. */
  ownerOnly?: boolean
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const allGroups = computed<NavGroup[]>(() => [
  {
    label: t('Clinic', 'Clínica'),
    items: [
      { label: t('Clinics', 'Clínicas'), to: '/settings/clinics', perm: 'clinic_config' },
      { label: t('Online Booking', 'Reserva online'), to: '/settings/online-booking', perm: 'clinic_config' },
      { label: t('Team', 'Equipo'), to: '/settings/team', perm: 'team_admin' },
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
      { label: t('Services & Products', 'Servicios y productos'), to: '/settings/services', perm: 'billing_config' },
      { label: t('Packages / Bonos', 'Paquetes / Bonos'), to: '/settings/packages', perm: 'billing_config' },
      { label: t('Memberships', 'Membresías'), to: '/settings/memberships', perm: 'billing_config' },
      { label: t('Payments (Stripe)', 'Pagos (Stripe)'), to: '/settings/payments', perm: 'billing_config' },
      { label: t('Payment Methods', 'Métodos de pago'), to: '/settings/payment-methods', perm: 'billing_config' },
      { label: t('Receipt Settings', 'Configuración de recibos'), to: '/settings/invoice-settings', perm: 'billing_config' },
      { label: t('Fiscal Data', 'Datos fiscales'), to: '/settings/fiscal-data', perm: 'billing_config' },
      { label: 'VeriFactu', to: '/settings/verifactu', ownerOnly: true },
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
      { label: t('Compress Files', 'Comprimir archivos'), to: '/settings/compress-files', perm: 'data_admin' },
      { label: t('Webhooks', 'Webhooks'), to: '/settings/webhooks', perm: 'data_admin' },
    ],
  },
  {
    label: t('Developers', 'Desarrolladores'),
    items: [{ label: t('API & Tokens', 'API y tokens'), to: '/settings/developers', perm: 'developers_access' }],
  },
])

const groups = computed(() =>
  allGroups.value.map((group) => ({ ...group, items: group.items.filter((item) => (!item.perm || can(item.perm)) && (!item.ownerOnly || store.isOwner)) })).filter((group) => group.items.length > 0),
)

// A section stays lit on its own detail pages -- Clinics on
// /settings/clinics/<id>, Roles on /settings/roles/<id>.
function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

// This component is embedded identically at the top of ~29 settings pages
// (see the `flex-1` sibling right after <SettingsNav /> in each one), none
// of which have their own place to host a menu button -- fixed positioning
// means the mobile trigger/drawer don't depend on whatever flex/grid
// context the page around them happens to use, so this is a one-file fix
// rather than 29 page edits. Closes on navigation, same as AppSidebar's
// own mobile drawer.
const mobileOpen = ref(false)
watch(() => route.fullPath, () => (mobileOpen.value = false))
</script>

<template>
  <button
    v-if="!mobileOpen"
    type="button"
    class="fixed bottom-6 left-4 z-30 flex h-9 touch:h-11 items-center gap-2 rounded-pill border border-line bg-surface px-4 text-[13px] font-medium text-ink-700 shadow-card lg:hidden"
    @click="mobileOpen = true"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.5 3.5h11M1.5 7h11M1.5 10.5h11" /></svg>
    {{ t('Sections', 'Secciones') }}
  </button>

  <div v-if="mobileOpen" class="fixed inset-0 z-40 bg-black/40 lg:hidden" @click="mobileOpen = false" />

  <nav
    class="fixed inset-y-0 left-0 z-50 w-[280px] space-y-5 overflow-y-auto bg-surface-sidebar p-3 transition-transform duration-200 print:hidden lg:static lg:z-auto lg:w-[220px] lg:shrink-0 lg:translate-x-0"
    :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="flex items-center justify-between lg:block">
      <NuxtLink to="/settings" class="block px-2 text-[13px] font-semibold text-ink-900 hover:text-brand"> {{ t('Settings', 'Ajustes') }} </NuxtLink>
      <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-ink-muted2 hover:bg-surface-subtle lg:hidden" @click="mobileOpen = false">
        <svg width="13" height="13" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
      </button>
    </div>
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
