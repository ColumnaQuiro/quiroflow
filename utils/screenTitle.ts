// The browser-tab title for a staff screen, named the way the sidebar names
// it. Every staff page had an empty <title>, so a row of QuiroFlow tabs all
// read the address, a screen reader announced nothing on arriving at a page
// (NuxtRouteAnnouncer reads the title), and browser history was a list of
// URLs. A page that sets its own title (useHead) still wins: app.vue sets
// this one first.
//
// Deliberately never a patient's name: tab titles end up in browser history
// and on a shared front-desk screen.

type T = (en: string, es: string) => string

// Most specific first; the first prefix that matches wins.
const SCREENS: [prefix: string, title: (t: T) => string][] = [
  ['/settings', (t) => t('Settings', 'Ajustes')],
  ['/dashboard', (t) => t('Dashboard', 'Panel')],
  ['/practitioner', (t) => t('My Day', 'Mi día')],
  ['/calendar', (t) => t('Calendar', 'Calendario')],
  ['/jornada', (t) => t('Working time', 'Registro de jornada')],
  ['/team-chat', (t) => t('Team', 'Equipo')],
  ['/patients/posture', (t) => t('Posture', 'Postura')],
  ['/patients/', (t) => t('Patient', 'Paciente')],
  ['/patients', (t) => t('Patients', 'Pacientes')],
  ['/recalls', (t) => t('Recalls', 'Recordatorios')],
  ['/waitlist', (t) => t('Waitlist', 'Lista de espera')],
  ['/care-plan-alerts', (t) => t('Care Plan Alerts', 'Alertas de plan')],
  ['/inbox', (t) => t('Inbox', 'Bandeja de entrada')],
  ['/campaigns', (t) => t('Campaigns', 'Campañas')],
  ['/billing/third-parties', (t) => t('Third parties', 'Terceros')],
  ['/billing/new', (t) => t('New receipt', 'Nuevo recibo')],
  ['/billing/', (t) => t('Receipt', 'Recibo')],
  ['/billing', (t) => t('Billing', 'Facturación')],
  ['/reports', (t) => t('Reports', 'Informes')],
  ['/growth/leads', (t) => t('Leads', 'Contactos')],
  ['/growth/receptionist', (t) => t('AI Receptionist', 'Recepcionista IA')],
  ['/growth/reputation', (t) => t('Reputation', 'Reputación')],
  ['/growth/automations', (t) => t('Automations', 'Automatizaciones')],
  ['/growth', (t) => t('Growth', 'Crecimiento')],
  ['/account', (t) => t('Account', 'Cuenta')],
  ['/subscription', (t) => t('Subscription', 'Suscripción')],
  ['/onboarding', (t) => t('Set up your clinic', 'Configura tu clínica')],
  ['/login', (t) => t('Sign in', 'Iniciar sesión')],
  ['/signup', (t) => t('Create account', 'Crear cuenta')],
  ['/two-factor', (t) => t('Two-step verification', 'Verificación en dos pasos')],
  ['/forgot-password', (t) => t('Forgot password', 'Contraseña olvidada')],
  ['/reset-password', (t) => t('New password', 'Nueva contraseña')],
  ['/check-email', (t) => t('Check your email', 'Revisa tu correo')],
  ['/join', (t) => t('Join your team', 'Únete a tu equipo')],
]

// The patient-facing pages (booking, portal, a waitlist or photo link) are
// not here: they carry the clinic's name, not ours, or set their own.
const PUBLIC = ['/waitlist/']

export function screenTitle(path: string, t: T): string | null {
  if (PUBLIC.some((p) => path.startsWith(p))) return null
  const hit = SCREENS.find(([prefix]) => (prefix.endsWith('/') ? path.startsWith(prefix) && path.length > prefix.length : path === prefix || path.startsWith(`${prefix}/`)))
  return hit ? `${hit[1](t)} · QuiroFlow` : null
}
