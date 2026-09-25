// What a role can hold, described in the words the roles editor, the roles
// list and the compare page all use -- one catalogue, so the three can never
// disagree about what a key is called or what it does.
//
// The KEYS are the stored contract and are never renamed here: RLS policies,
// server routes and specs read them by name, and a role saved last year must
// keep meaning what it meant. Only the labels, the grouping and the
// descriptions are presentation. Each description says what the permission
// actually controls in the app today -- if a key's enforcement changes, its
// description here is the thing to update.

type T = (en: string, es: string) => string

export type Scope3 = 'all' | 'own' | 'none'
export type Scope2 = 'all' | 'own'

export interface RolePermissions {
  dashboard_scope: Scope3
  calendar_scope: Scope3
  patients_scope: Scope3
  calendar_read_only: boolean
  settings_access: boolean
  roles_admin: boolean
  team_admin: boolean
  clinic_config: boolean
  billing_config: boolean
  communication_config: boolean
  data_admin: boolean
  developers_access: boolean
  billing_access: boolean
  recalls_access: boolean
  inbox_access: boolean
  reports_access: boolean
  reports_own_only: boolean
  appointments_delete: boolean
  patients_edit: boolean
  patients_delete_merge: boolean
  patients_tags_remove: boolean
  financials_edit_all: boolean
  financials_edit_same_day_only: boolean
  payments_allocate: boolean
  packages_edit: boolean
  billing_history_view: boolean
  patient_docs_delete: boolean
  patient_files_delete: boolean
  visit_notes_access: boolean
  visit_notes_scope: Scope2
  visit_notes_edit: boolean
  visit_notes_delete: boolean
  docs_files_scope: Scope2
}

export type BooleanPermissionKey = { [K in keyof RolePermissions]: RolePermissions[K] extends boolean ? K : never }[keyof RolePermissions]

/**
 * What an editor shows for a key a stored role does not carry. Everything
 * off: a missing key is refused by has_permission() and read as 'none' by
 * permission_scope(), so showing it as granted would misrepresent what is in
 * force. The two note/document scopes default to 'own' because that is the
 * narrower of their two values.
 */
export const EMPTY_PERMISSIONS: RolePermissions = {
  dashboard_scope: 'none',
  calendar_scope: 'none',
  patients_scope: 'none',
  calendar_read_only: false,
  settings_access: false,
  roles_admin: false,
  team_admin: false,
  clinic_config: false,
  billing_config: false,
  communication_config: false,
  data_admin: false,
  developers_access: false,
  billing_access: false,
  recalls_access: false,
  inbox_access: false,
  reports_access: false,
  reports_own_only: false,
  appointments_delete: false,
  patients_edit: false,
  patients_delete_merge: false,
  patients_tags_remove: false,
  financials_edit_all: false,
  financials_edit_same_day_only: false,
  payments_allocate: false,
  packages_edit: false,
  billing_history_view: false,
  patient_docs_delete: false,
  patient_files_delete: false,
  visit_notes_access: false,
  visit_notes_scope: 'own',
  visit_notes_edit: false,
  visit_notes_delete: false,
  docs_files_scope: 'own',
}

export function permissionsWithDefaults(stored: unknown): RolePermissions {
  return { ...EMPTY_PERMISSIONS, ...((stored ?? {}) as Partial<RolePermissions>) }
}

/**
 * The two stored booleans financials_edit_all / financials_edit_same_day_only
 * are one three-way choice to a person. Both true reads as 'all', which is
 * what the policies do with it.
 */
export type FinancialsMode = 'none' | 'same_day' | 'all'
export function financialsMode(p: Pick<RolePermissions, 'financials_edit_all' | 'financials_edit_same_day_only'>): FinancialsMode {
  return p.financials_edit_all ? 'all' : p.financials_edit_same_day_only ? 'same_day' : 'none'
}
export function setFinancialsMode(p: RolePermissions, mode: FinancialsMode) {
  p.financials_edit_all = mode === 'all'
  p.financials_edit_same_day_only = mode === 'same_day'
}

export interface ToggleRow {
  kind: 'toggle'
  key: BooleanPermissionKey
  label: string
  description: string
  /** Short label for the compare table, where the full one does not fit. */
  short?: string
}
export interface ScopeRow {
  kind: 'scope'
  key: 'dashboard_scope' | 'calendar_scope' | 'patients_scope' | 'visit_notes_scope' | 'docs_files_scope' | 'financials'
  label: string
  description: string
  options: { value: string; label: string; short?: string }[]
  short?: string
}
export type PermissionRow = ToggleRow | ScopeRow

export interface PermissionGroup {
  id: string
  title: string
  subtitle: string
  rows: PermissionRow[]
}

export function permissionGroups(t: T): PermissionGroup[] {
  return [
    {
      id: 'ver',
      title: t('What they see', 'Qué ve'),
      subtitle: t('What appears in their menu and their lists.', 'Lo que aparece en su menú y en sus listas.'),
      rows: [
        {
          kind: 'scope',
          key: 'dashboard_scope',
          label: t('Dashboard', 'Panel'),
          description: t(
            'The figures on the home page. "Only their own" shows their appointments, takings and patients, not the clinic\'s.',
            'Las cifras del inicio. «Solo sus datos» enseña sus citas, cobros y pacientes, no los de la clínica.',
          ),
          options: [
            { value: 'all', label: t('Everything', 'Todo') },
            { value: 'own', label: t('Only their own', 'Solo sus datos') },
            { value: 'none', label: t('Nothing', 'Nada') },
          ],
        },
        {
          kind: 'scope',
          key: 'calendar_scope',
          label: t('Calendar', 'Calendario'),
          description: t('Which appointments they see in the calendar and in My day.', 'Qué citas ve en el calendario y en Mi día.'),
          options: [
            { value: 'all', label: t('All appointments', 'Todas las citas'), short: t('All', 'Todas') },
            { value: 'own', label: t('Only their own', 'Solo las suyas') },
            { value: 'none', label: t('Nothing', 'Nada') },
          ],
        },
        {
          kind: 'toggle',
          key: 'calendar_read_only',
          label: t('Read-only calendar', 'Calendario de solo lectura'),
          description: t('Sees appointments but cannot create, move, edit or delete any.', 'Ve las citas pero no puede crear, mover, editar ni eliminar ninguna.'),
        },
        {
          kind: 'scope',
          key: 'patients_scope',
          label: t('Patients', 'Pacientes'),
          description: t(
            '"Their own" are the patients with an appointment with this person, or who have them as their usual practitioner.',
            '«Los suyos» son los que tienen una cita con esta persona o la tienen como profesional habitual.',
          ),
          options: [
            { value: 'all', label: t('All', 'Todos') },
            { value: 'own', label: t('Only their own', 'Solo los suyos') },
            { value: 'none', label: t('None', 'Ninguno') },
          ],
        },
      ],
    },
    {
      id: 'pacientes',
      title: t('Patients and appointments', 'Pacientes y citas'),
      subtitle: t('Within what they can see.', 'Dentro de lo que puede ver.'),
      rows: [
        {
          kind: 'toggle',
          key: 'patients_edit',
          label: t('Edit patient details', 'Editar datos de pacientes'),
          description: t('Name, contact, clinical details and tags on the patient record.', 'Nombre, contacto, datos clínicos y etiquetas de la ficha.'),
        },
        {
          kind: 'toggle',
          key: 'patients_tags_remove',
          label: t('Remove bono or membership tags', 'Quitar etiquetas de bono o membresía'),
          short: t('Remove bono tags', 'Quitar etiquetas de bono'),
          description: t('Take off a patient the tag a bono or a membership gave them.', 'Quitar a un paciente la etiqueta que le puso un bono o una membresía.'),
        },
        {
          kind: 'toggle',
          key: 'patients_delete_merge',
          label: t('Delete and merge patients', 'Eliminar y fusionar pacientes'),
          description: t('Delete a record, or join two duplicate records into one.', 'Borrar una ficha o unir dos fichas duplicadas.'),
        },
        {
          kind: 'toggle',
          key: 'appointments_delete',
          label: t('Delete appointments', 'Eliminar citas'),
          description: t('Remove an appointment from the calendar (cancelling one is always allowed).', 'Borrar una cita del calendario (cancelarla siempre se puede).'),
        },
      ],
    },
    {
      id: 'notas',
      title: t('Clinical notes, documents and files', 'Notas clínicas, documentos y archivos'),
      subtitle: t('The clinical information on the record.', 'La información clínica de la ficha.'),
      rows: [
        {
          kind: 'toggle',
          key: 'visit_notes_access',
          label: t('See visit notes', 'Ver notas de visita'),
          short: t('See notes', 'Ver notas'),
          description: t('Without this, notes do not appear on the record or the appointment.', 'Sin esto, las notas no aparecen en la ficha ni en la cita.'),
        },
        {
          kind: 'toggle',
          key: 'visit_notes_edit',
          label: t('Write and edit notes', 'Escribir y editar notas'),
          description: t('Needs "See visit notes".', 'Necesita «Ver notas de visita».'),
        },
        {
          kind: 'toggle',
          key: 'visit_notes_delete',
          label: t('Delete notes', 'Eliminar notas'),
          description: '',
        },
        {
          kind: 'scope',
          key: 'visit_notes_scope',
          label: t('Which notes they can edit or delete', 'Qué notas puede editar o eliminar'),
          short: t('Which notes they edit', 'Qué notas edita'),
          description: '',
          options: [
            { value: 'all', label: t("Anyone's", 'Las de cualquiera'), short: t('Anyone', 'Cualquiera') },
            { value: 'own', label: t('Only their own', 'Solo las suyas'), short: t('Own', 'Suyas') },
          ],
        },
        {
          kind: 'scope',
          key: 'docs_files_scope',
          label: t('Documents and files they see', 'Documentos y archivos que ve'),
          description: t('Imported ones with no author are visible to everyone.', 'Los importados sin autor los ve todo el mundo.'),
          options: [
            { value: 'all', label: t("Anyone's", 'Los de cualquiera'), short: t('Anyone', 'Cualquiera') },
            { value: 'own', label: t('Only their own', 'Solo los suyos'), short: t('Own', 'Suyos') },
          ],
        },
        {
          kind: 'toggle',
          key: 'patient_docs_delete',
          label: t('Delete documents', 'Eliminar documentos'),
          description: t('Consent and other forms.', 'Consentimientos y formularios.'),
        },
        {
          kind: 'toggle',
          key: 'patient_files_delete',
          label: t('Delete files', 'Eliminar archivos'),
          description: t('Images, PDFs and attachments.', 'Imágenes, PDF y adjuntos.'),
        },
      ],
    },
    {
      id: 'dinero',
      title: t('Money', 'Dinero'),
      subtitle: t('Charging, bonos and the till.', 'Cobros, bonos y caja.'),
      rows: [
        {
          kind: 'toggle',
          key: 'billing_access',
          label: t('Charge and issue receipts', 'Cobrar y hacer recibos'),
          description: t('Charge appointments, create and send receipts and facturas.', 'Cobrar citas, crear y enviar recibos y facturas.'),
        },
        {
          kind: 'toggle',
          key: 'billing_history_view',
          label: t('See billing history', 'Ver el historial de cobros'),
          short: t('See billing history', 'Ver historial de cobros'),
          description: t("The billing tab on the patient record and the patient's statement.", 'La pestaña de cobros de la ficha y el extracto del paciente.'),
        },
        {
          kind: 'toggle',
          key: 'payments_allocate',
          label: t('Record payments and run the till', 'Registrar pagos y llevar la caja'),
          short: t('Payments and till', 'Pagos y caja'),
          description: t(
            'Allocate payments to receipts, open and close till shifts and record cash in and out.',
            'Asignar pagos a recibos, abrir y cerrar turnos de caja y apuntar entradas y salidas.',
          ),
        },
        {
          kind: 'scope',
          key: 'financials',
          label: t('Correct past charges', 'Corregir cobros ya hechos'),
          short: t('Correct charges', 'Corregir cobros'),
          description: t('Edit or void receipts, refund payments.', 'Editar o anular recibos, devolver pagos.'),
          options: [
            { value: 'none', label: t('No', 'No') },
            { value: 'same_day', label: t('Same day only', 'Solo el mismo día'), short: t('Same day', 'Mismo día') },
            { value: 'all', label: t('Always', 'Siempre') },
          ],
        },
        {
          kind: 'toggle',
          key: 'packages_edit',
          label: t('Sell and edit bonos and memberships', 'Vender y editar bonos y membresías'),
          short: t('Sell and edit bonos', 'Vender y editar bonos'),
          description: t('Sell them from the patient record, change sessions or void one already sold.', 'Venderlos desde la ficha, cambiar sesiones o anular uno vendido.'),
        },
      ],
    },
    {
      id: 'comunicacion',
      title: t('Communication', 'Comunicación'),
      subtitle: t('Talking to patients.', 'Hablar con los pacientes.'),
      rows: [
        {
          kind: 'toggle',
          key: 'inbox_access',
          label: t('Inbox', 'Bandeja de entrada'),
          description: t('Read and answer WhatsApp, Instagram and app messages.', 'Leer y contestar WhatsApp, Instagram y mensajes de la app.'),
        },
        {
          kind: 'toggle',
          key: 'recalls_access',
          label: t('Recalls, waitlist and plan alerts', 'Recordatorios, lista de espera y alertas de plan'),
          short: t('Recalls and lists', 'Recordatorios y listas'),
          description: t(
            'The three lists of patients to contact, and sending them email or WhatsApp from the record.',
            'Las tres listas de pacientes a contactar, y enviarles email o WhatsApp desde la ficha.',
          ),
        },
      ],
    },
    {
      id: 'informes',
      title: t('Reports', 'Informes'),
      subtitle: '',
      rows: [
        { kind: 'toggle', key: 'reports_access', label: t('See reports', 'Ver informes'), description: '' },
        {
          kind: 'toggle',
          key: 'reports_own_only',
          label: t('Only their own figures', 'Solo sus propios datos'),
          description: t('Reports only count their appointments, takings and patients.', 'Los informes solo cuentan sus citas, cobros y pacientes.'),
        },
      ],
    },
    {
      id: 'ajustes',
      title: t('Settings and administration', 'Ajustes y administración'),
      subtitle: t(
        'How the clinic is set up. Without "Open Settings", nothing in this section shows.',
        'Configuración de la clínica. Sin «Entrar en Ajustes», nada de esta sección aparece.',
      ),
      rows: [
        { kind: 'toggle', key: 'settings_access', label: t('Open Settings', 'Entrar en Ajustes'), description: '' },
        {
          kind: 'toggle',
          key: 'team_admin',
          label: t('Team', 'Equipo'),
          description: t('Invite, change roles, locations and hours, deactivate.', 'Invitar, cambiar roles, sedes y horarios, desactivar.'),
        },
        {
          kind: 'toggle',
          key: 'roles_admin',
          label: t('Roles and permissions', 'Roles y permisos'),
          description: t('Create and change roles like this one.', 'Crear y cambiar roles como este.'),
        },
        {
          kind: 'toggle',
          key: 'clinic_config',
          label: t('Clinic and diary', 'Clínica y agenda'),
          description: t(
            'Locations, appointment types, resources, online booking, appointment policies, modalities and new-patient fields.',
            'Sedes, tipos de cita, recursos, reserva online, políticas de citas, modalidades y campos de paciente nuevo.',
          ),
        },
        {
          kind: 'toggle',
          key: 'billing_config',
          label: t('Billing', 'Facturación'),
          description: t(
            'Services, catalogue bonos and memberships, Stripe, payment methods, receipts and tax details.',
            'Servicios, bonos y membresías del catálogo, Stripe, métodos de pago, recibos y datos fiscales.',
          ),
        },
        {
          kind: 'toggle',
          key: 'communication_config',
          label: t('Communication and Growth', 'Comunicación y Growth'),
          description: t('WhatsApp, templates, saved replies, documents, campaigns and all of Growth.', 'WhatsApp, plantillas, respuestas guardadas, documentos, campañas y todo Growth.'),
        },
        {
          kind: 'toggle',
          key: 'data_admin',
          label: t('Data', 'Datos'),
          description: t('Import patients, migrate files, webhooks.', 'Importar pacientes, migrar archivos, webhooks.'),
        },
        {
          kind: 'toggle',
          key: 'developers_access',
          label: t('Developer API', 'API para desarrolladores'),
          description: t('Create and revoke API keys.', 'Crear y revocar claves de API.'),
        },
      ],
    },
  ]
}

/** The stored value of a row, as the option value its control uses. */
export function rowValue(p: RolePermissions, row: PermissionRow): string | boolean {
  if (row.kind === 'toggle') return p[row.key]
  if (row.key === 'financials') return financialsMode(p)
  return p[row.key]
}

/** A compact rendering of one row's value, for the compare table. */
export function rowValueLabel(p: RolePermissions, row: PermissionRow, t: T): string {
  if (row.kind === 'toggle') return p[row.key] ? t('Yes', 'Sí') : '—'
  const value = rowValue(p, row)
  const option = row.options.find((o) => o.value === value)
  return option ? (option.short ?? option.label) : '—'
}

// The three roles every account is seeded with. Their NAMES are stored in
// English and stay that way: specs, db tasks and the invite flow look them up
// by that exact string (`.eq('name', 'Practitioner')`), so translating the
// stored value would break them. Only what is shown is translated. A role the
// clinic created itself is shown exactly as it was typed.
const DEFAULT_ROLE_NAMES: Record<string, [string, string]> = {
  Owner: ['Owner', 'Propietario'],
  Practitioner: ['Practitioner', 'Profesional'],
  'Front Desk': ['Front Desk', 'Recepción'],
}

export function displayRoleName(name: string, t: T): string {
  const known = DEFAULT_ROLE_NAMES[name]
  return known ? t(known[0], known[1]) : name
}

/**
 * Case- and space-insensitive, and across both languages of the default
 * names: a Spanish-speaking owner who types "Recepción" sees that name on
 * the list already, so it has to be taken even though what is stored is
 * "Front Desk".
 */
export function roleNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}
export function roleNameTaken(name: string, roles: { id: string; name: string }[], exceptId?: string): { id: string; name: string } | null {
  const key = roleNameKey(name)
  if (!key) return null
  for (const r of roles) {
    if (r.id === exceptId) continue
    const shown = DEFAULT_ROLE_NAMES[r.name] ?? [r.name, r.name]
    if ([r.name, ...shown].some((n) => roleNameKey(n) === key)) return r
  }
  return null
}

/**
 * The chips under each role on the list: the handful of things that tell
 * two roles apart at a glance, not all thirty-odd keys.
 */
export function summaryChips(p: RolePermissions, t: T): string[] {
  const chips: string[] = []
  if (p.calendar_scope === 'all') chips.push(t('Calendar: all', 'Calendario: todas'))
  else if (p.calendar_scope === 'own') chips.push(t('Calendar: only their own', 'Calendario: solo sus citas'))
  if (p.calendar_scope !== 'none' && p.calendar_read_only) chips.push(t('Read-only calendar', 'Calendario de solo lectura'))
  if (p.patients_scope === 'all') chips.push(t('Patients: all', 'Pacientes: todos'))
  else if (p.patients_scope === 'own') chips.push(t('Patients: only their own', 'Pacientes: solo los suyos'))
  if (p.billing_access && p.payments_allocate) chips.push(t('Charge and till', 'Cobrar y caja'))
  else if (p.billing_access) chips.push(t('Charge', 'Cobrar'))
  if (p.inbox_access) chips.push(t('Inbox', 'Bandeja de entrada'))
  if (!p.visit_notes_access) chips.push(t('No clinical notes', 'Sin notas clínicas'))
  if (p.reports_access) chips.push(p.reports_own_only ? t('Reports: only their own', 'Informes: solo los suyos') : t('Reports', 'Informes'))
  if (p.settings_access) {
    const areas = [
      p.team_admin && t('team', 'equipo'),
      p.roles_admin && t('roles', 'roles'),
      p.clinic_config && t('clinic', 'clínica'),
      p.billing_config && t('billing', 'facturación'),
      p.communication_config && t('communication', 'comunicación'),
      p.data_admin && t('data', 'datos'),
    ].filter(Boolean)
    chips.push(areas.length ? `${t('Settings', 'Ajustes')}: ${areas.join(', ')}` : t('Settings', 'Ajustes'))
  }
  return chips
}

// Descriptions for the three default roles. The migration stores the Spanish
// text (20260925074722); while a role still carries exactly that, it is shown
// in the viewer's language like the role's name. Once an owner has written
// their own, theirs is shown as written. A role with none at all falls back to
// the default too, so an older account still says something useful.
export function displayRoleDescription(name: string, description: string | null | undefined, t: T): string {
  const stored = description?.trim() ?? ''
  const seeded = defaultRoleDescription(name, (_en, es) => es)
  if (!stored || stored === seeded) return defaultRoleDescription(name, t)
  return stored
}

export function defaultRoleDescription(name: string, t: T): string {
  if (name === 'Owner') return t("Full access. Cannot be edited: what decides an owner's access is being the owner, not the role.", 'Acceso total. No se puede editar: lo que decide el acceso de un propietario es ser propietario, no el rol.')
  if (name === 'Practitioner') return t('Sees their own patients: their calendar, their records, their notes and their reports.', 'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.')
  if (name === 'Front Desk') return t('Runs the diary and the desk: every patient and appointment, charging, the till and the inbox.', 'Lleva la agenda y el mostrador: todos los pacientes y citas, cobros, caja y bandeja de entrada.')
  return ''
}
