import { isRouteAllowed } from '../utils/routePermissions'

// The Settings pages, grouped as the Settings menu shows them. One
// definition, read by that menu (components/settings/Nav.vue) and by the
// command palette (components/AppCommandPalette.vue), which offers each as
// "Settings › WhatsApp" to exactly the people the menu shows it to.
//
// A relative import, not `~`: the mobile app scans this directory too, and
// there `~` is mobile/.

export interface SettingsNavItem {
  label: string
  to: string
  perm?: string
  /** The company's own settings (VeriFactu): owners only, whatever the role grants. */
  ownerOnly?: boolean
}
export interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

export function useSettingsNavItems() {
  const { can } = usePermission()
  const store = useAccountStore()
  const t = useT()

  const allGroups = computed<SettingsNavGroup[]>(() => [
    // Eleven short groups where there were seven long ones: Communication and
    // Billing had nine pages each, mixing channels with templates and lead
    // handling, and what is sold with how it is charged. No group has more
    // than six now, and every page sits beside the ones it is used with.
    {
      label: t('Clinic', 'Clínica'),
      items: [
        { label: t('Clinics', 'Clínicas'), to: '/settings/clinics', perm: 'clinic_config' },
        { label: t('Team', 'Equipo'), to: '/settings/team', perm: 'team_admin' },
        { label: t('Roles & Permissions', 'Roles y permisos'), to: '/settings/roles', perm: 'roles_admin' },
      ],
    },
    {
      label: t('Scheduling', 'Agenda'),
      items: [
        { label: t('Appointment Types', 'Tipos de cita'), to: '/settings/appointment-types', perm: 'clinic_config' },
        { label: t('Changes & cancellations', 'Cambios y cancelaciones'), to: '/settings/reschedule-reasons', perm: 'clinic_config' },
        { label: t('Rooms', 'Salas'), to: '/settings/rooms', perm: 'clinic_config' },
      ],
    },
    // Everything a patient sees of the clinic outside it: the booking page,
    // the app, and the clinic's look in the app.
    {
      label: t('For your patients', 'Para tus pacientes'),
      items: [
        { label: t('Online Booking', 'Reserva online'), to: '/settings/online-booking', perm: 'clinic_config' },
        { label: t('Mobile App', 'App móvil'), to: '/settings/app', perm: 'clinic_config' },
        { label: t('Brand', 'Marca'), to: '/settings/branding', perm: 'clinic_config' },
      ],
    },
    {
      label: t('Patient record', 'Ficha del paciente'),
      items: [
        { label: t('Patient types', 'Tipos de paciente'), to: '/settings/patient-types', perm: 'clinic_config' },
        { label: t('Referral Sources', 'Fuentes de referencia'), to: '/settings/referral-sources', perm: 'clinic_config' },
        { label: t('New Patient Fields', 'Campos de nuevo paciente'), to: '/settings/new-patient-fields', perm: 'clinic_config' },
        { label: t('Custom Fields', 'Campos personalizados'), to: '/settings/custom-fields', perm: 'clinic_config' },
      ],
    },
    // What the clinic hands a patient during their care.
    {
      label: t('Clinical content', 'Contenido clínico'),
      items: [
        { label: t('Care plans', 'Planes de cuidados'), to: '/settings/care-plans', perm: 'clinic_config' },
        { label: t('Docs', 'Documentos'), to: '/settings/docs', perm: 'communication_config' },
        { label: t('Letters', 'Cartas'), to: '/settings/letters', perm: 'communication_config' },
        { label: t('Education', 'Educación'), to: '/settings/education', perm: 'clinic_config' },
      ],
    },
    {
      label: t('What you sell', 'Lo que vendes'),
      items: [
        { label: t('Services', 'Servicios'), to: '/settings/services', perm: 'billing_config' },
        { label: t('Products & stock', 'Productos y stock'), to: '/settings/products', perm: 'billing_config' },
        { label: t('Packages / Bonos', 'Paquetes / Bonos'), to: '/settings/packages', perm: 'billing_config' },
        { label: t('Gift vouchers', 'Bonos regalo'), to: '/settings/gift-vouchers', perm: 'billing_config' },
        { label: t('Memberships', 'Membresías'), to: '/settings/memberships', perm: 'billing_config' },
      ],
    },
    {
      label: t('Payments & invoices', 'Cobros y facturas'),
      items: [
        { label: t('Payments', 'Pagos'), to: '/settings/payments', perm: 'billing_config' },
        { label: t('Invoicing', 'Facturación'), to: '/settings/invoicing', perm: 'billing_config' },
        { label: 'VeriFactu', to: '/settings/verifactu', ownerOnly: true },
        { label: t('Third parties', 'Terceros'), to: '/settings/third-parties', perm: 'billing_config' },
      ],
    },
    {
      label: t('Communication', 'Comunicación'),
      items: [
        { label: t('Messages', 'Mensajes'), to: '/settings/messages', perm: 'communication_config' },
        { label: t('WhatsApp', 'WhatsApp'), to: '/settings/whatsapp', perm: 'communication_config' },
        { label: t('Instagram & Messenger', 'Instagram y Messenger'), to: '/settings/instagram', perm: 'communication_config' },
        { label: t('Website chat', 'Chat en tu web'), to: '/settings/webchat', perm: 'communication_config' },
        { label: t('Saved Replies', 'Respuestas guardadas'), to: '/settings/saved-replies', perm: 'communication_config' },
        { label: t('Team alerts', 'Avisos al equipo'), to: '/settings/team-alerts', perm: 'communication_config' },
      ],
    },
    // Bringing patients in and back: leads (and the Meta connections that
    // bring them), recalls, and where happy patients are sent to review.
    {
      label: t('Acquisition', 'Captación'),
      items: [
        { label: t('Leads', 'Leads'), to: '/settings/leads', perm: 'communication_config' },
        { label: t('Recalls', 'Recuperaciones'), to: '/settings/recalls', perm: 'communication_config' },
        { label: t('Reviews', 'Reseñas'), to: '/settings/reviews', perm: 'communication_config' },
      ],
    },
    {
      label: t('Data & security', 'Datos y seguridad'),
      items: [
        { label: t('Import', 'Importar'), to: '/settings/import', perm: 'data_admin' },
        { label: t('Files', 'Archivos'), to: '/settings/files', perm: 'data_admin' },
        { label: t('Activity log', 'Registro de actividad'), to: '/settings/activity', ownerOnly: true },
        { label: t('Privacy', 'Privacidad'), to: '/settings/privacy', ownerOnly: true },
      ],
    },
    {
      label: t('Developers', 'Desarrolladores'),
      items: [
        { label: t('API & Tokens', 'API y tokens'), to: '/settings/developers', perm: 'developers_access' },
        { label: t('Webhooks', 'Webhooks'), to: '/settings/webhooks', perm: 'developers_access' },
      ],
    },
  ])

  // The item's own permission, owner-only items, and the route guard, which
  // is what adds settings_access to every one of them.
  const groups = computed(() =>
    allGroups.value.map((group) => ({ ...group, items: group.items.filter((item) => (!item.perm || can(item.perm)) && (!item.ownerOnly || store.isOwner) && isRouteAllowed(store, item.to)) })).filter((group) => group.items.length > 0),
  )

  return { allGroups, groups }
}
