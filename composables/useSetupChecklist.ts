// Everything a new clinic has to set up before QuiroFlow runs on its own,
// read from the clinic's own data -- the same rule as the dashboard's first
// steps (components/dashboard/FirstSteps.vue): doing a step from anywhere
// ticks it here, and a clinic that has already done it never sees it open.
//
// Some steps do not apply to every clinic (a practitioner working alone has
// no team to invite; a clinic starting from nothing has nothing to import).
// Those can be skipped, and the skip is remembered per account in this
// browser. A skipped step counts as settled, never as done: the page still
// shows it as skipped and it can be undone.

export type SetupStepKey =
  | 'clinic'
  | 'services'
  | 'team'
  | 'import'
  | 'whatsapp'
  | 'reminders'
  | 'online_booking'
  | 'fiscal'
  | 'verifactu'
  | 'plan'
  | 'two_factor'
  | 'first_visit'

export interface SetupStep {
  key: SetupStepKey
  group: 'clinic' | 'patients' | 'messages' | 'billing' | 'account'
  done: boolean
  skippable: boolean
  title: string
  body: string
  action: { label: string; to: string }
  alternative?: { label: string; to: string }
}

export function useSetupChecklist() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const t = useT()
  const twoFactor = useTwoFactor()

  const loaded = ref(false)
  const failed = ref(false)
  const facts = reactive({
    clinicDetails: false,
    services: false,
    team: false,
    imported: false,
    whatsapp: false,
    reminders: false,
    onlineBooking: false,
    fiscal: false,
    verifactu: false,
    twoFactor: false,
    firstVisit: false,
  })
  const skipped = ref<Set<SetupStepKey>>(new Set())

  // localStorage can throw (private windows, blocked site data). Losing it
  // only means a skipped step shows as open again.
  const skipKey = () => `setup-skipped:${store.accountId}`
  function readSkipped() {
    try {
      const raw = localStorage.getItem(skipKey())
      skipped.value = new Set(raw ? (JSON.parse(raw) as SetupStepKey[]) : [])
    } catch {
      skipped.value = new Set()
    }
  }
  function writeSkipped() {
    try {
      localStorage.setItem(skipKey(), JSON.stringify([...skipped.value]))
    } catch {
      // ignore
    }
  }
  function skip(key: SetupStepKey) {
    skipped.value = new Set([...skipped.value, key])
    writeSkipped()
  }
  function unskip(key: SetupStepKey) {
    const next = new Set(skipped.value)
    next.delete(key)
    skipped.value = next
    writeSkipped()
  }

  async function load() {
    readSkipped()
    const accountId = store.accountId!
    const [account, clinics, types, members, invites, imported, appointments, reminderRules, mfa] = await Promise.all([
      supabase
        .from('accounts')
        .select('whatsapp_phone_number_id, whatsapp_reminder_template_name, appointment_reminder_enabled, verifactu_mode')
        .eq('id', accountId)
        .maybeSingle(),
      supabase.from('clinics').select('address, phone, tax_id, legal_name, online_booking_enabled').is('archived_at', null),
      supabase.from('appointment_types').select('id', { count: 'exact', head: true }).is('archived_at', null),
      supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('deleted_at', null),
      supabase.from('account_invites').select('id', { count: 'exact', head: true }).is('accepted_at', null),
      // What an importer wrote carries its source's reference; a patient
      // typed in by hand does not, so one test patient does not tick it.
      supabase.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', accountId).not('external_reference', 'is', null),
      supabase.from('appointments').select('id', { count: 'exact', head: true }),
      // A clinic can remind through an automation instead of the built-in
      // reminder ("24h before", "3 days before"), and then the built-in one
      // is rightly off.
      supabase.from('automation_rules').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('trigger_event', 'appointment.hours_before').eq('enabled', true),
      twoFactor.isEnabled().catch(() => false),
    ])
    // A failed read must not tell an established clinic to redo its setup,
    // so any error shows a notice instead of a list of open steps.
    if (account.error || clinics.error || types.error || members.error || invites.error || imported.error || appointments.error || reminderRules.error) {
      failed.value = true
      loaded.value = true
      return
    }
    const a = account.data
    const c = clinics.data ?? []
    facts.clinicDetails = c.length > 0 && c.every((x) => !!x.address?.trim() && !!x.phone?.trim())
    facts.services = (types.count ?? 0) > 0
    facts.team = (members.count ?? 0) > 1 || (invites.count ?? 0) > 0
    facts.imported = (imported.count ?? 0) > 0
    facts.whatsapp = !!a?.whatsapp_phone_number_id
    facts.reminders = (!!a?.appointment_reminder_enabled && !!a?.whatsapp_reminder_template_name) || (reminderRules.count ?? 0) > 0
    facts.onlineBooking = c.some((x) => x.online_booking_enabled)
    facts.fiscal = c.length > 0 && c.every((x) => !!x.tax_id?.trim() && !!x.legal_name?.trim())
    facts.verifactu = !!a?.verifactu_mode && a.verifactu_mode !== 'off'
    facts.twoFactor = mfa
    facts.firstVisit = (appointments.count ?? 0) > 0
    loaded.value = true
  }

  const steps = computed<SetupStep[]>(() => [
    {
      key: 'clinic',
      group: 'clinic',
      done: facts.clinicDetails,
      skippable: false,
      title: t('Your clinic’s address and phone', 'Dirección y teléfono de la clínica'),
      body: t(
        'Your booking page shows them, and confirmation and reminder messages can include them.',
        'Salen en tu página de reservas, y los mensajes de confirmación y recordatorio pueden incluirlos.',
      ),
      action: { label: t('Open Clinics', 'Abrir Clínicas'), to: '/settings/clinics' },
    },
    {
      key: 'services',
      group: 'clinic',
      done: facts.services,
      skippable: false,
      title: t('What you offer', 'Lo que ofreces'),
      body: t(
        'Each appointment type with its length and price. The calendar and online booking need at least one.',
        'Cada tipo de cita con su duración y su precio. La agenda y la reserva online necesitan al menos uno.',
      ),
      action: { label: t('Add a type', 'Añadir tipo'), to: '/settings/appointment-types?new=1' },
    },
    {
      key: 'team',
      group: 'clinic',
      done: facts.team,
      skippable: true,
      title: t('Your team', 'Tu equipo'),
      body: t(
        'Invite your practitioners and front desk, each with their own login, hours and calendar.',
        'Invita a tus profesionales y a recepción, cada uno con su acceso, su horario y su agenda.',
      ),
      action: { label: t('Invite someone', 'Invitar a alguien'), to: '/settings/team' },
    },
    {
      key: 'import',
      group: 'patients',
      done: facts.imported,
      skippable: true,
      title: t('Bring your patients over', 'Trae tus pacientes'),
      // Quirocitas is a source too, and the third source (pages/settings/import.vue)
      // reads a CSV or .xlsx file and brings patients only.
      body: t(
        'Patients, past and upcoming visits, bonos, payments and files from PracticeHub or Quirocitas, or patients alone from a CSV or Excel file.',
        'Pacientes, visitas pasadas y futuras, bonos, pagos y archivos desde PracticeHub o Quirocitas, o solo pacientes desde un archivo CSV o Excel.',
      ),
      action: { label: t('Import', 'Importar'), to: '/settings/import' },
      alternative: { label: t('Add one by hand', 'Añadir uno a mano'), to: '/patients?new=1' },
    },
    {
      key: 'whatsapp',
      group: 'messages',
      done: facts.whatsapp,
      skippable: false,
      title: t('Connect WhatsApp', 'Conecta WhatsApp'),
      body: t(
        'Confirmations and reminders go out by WhatsApp. Until it is connected, none of them are sent.',
        'Las confirmaciones y los recordatorios salen por WhatsApp. Hasta que lo conectes, no sale ninguno.',
      ),
      action: { label: t('Connect', 'Conectar'), to: '/settings/whatsapp' },
    },
    {
      key: 'reminders',
      group: 'messages',
      done: facts.reminders,
      skippable: false,
      title: t('Choose the reminder message', 'Elige el mensaje de recordatorio'),
      body: t(
        'The WhatsApp template that reminds each patient of their visit. Email is off unless you turn it on in Messages.',
        'La plantilla de WhatsApp que recuerda la cita a cada paciente. El email está apagado salvo que lo actives tú en Mensajes.',
      ),
      action: { label: t('Choose templates', 'Elegir plantillas'), to: '/settings/whatsapp' },
      alternative: { label: t('Timing and channels', 'Horario y canales'), to: '/settings/messages' },
    },
    {
      key: 'online_booking',
      group: 'messages',
      done: facts.onlineBooking,
      skippable: true,
      title: t('Online booking', 'Reserva online'),
      body: t(
        'A page where patients book themselves, only in the slots and types you allow.',
        'Una página donde los pacientes reservan solos, solo en los huecos y tipos que tú permitas.',
      ),
      action: { label: t('Set it up', 'Configurar'), to: '/settings/online-booking' },
    },
    {
      key: 'fiscal',
      group: 'billing',
      done: facts.fiscal,
      skippable: false,
      title: t('Fiscal details', 'Datos fiscales'),
      body: t(
        'Legal name and NIF for each clinic. Every invoice carries them.',
        'Razón social y NIF de cada clínica. Van en todas las facturas.',
      ),
      action: { label: t('Open Invoicing', 'Abrir Facturación'), to: '/settings/invoicing' },
    },
    {
      key: 'verifactu',
      group: 'billing',
      done: facts.verifactu,
      skippable: false,
      title: 'VeriFactu',
      body: t(
        'Required for every invoice from 1 January 2027. Upload your certificate, or let QuiroFlow send for you.',
        'Obligatorio para todas las facturas desde el 1 de enero de 2027. Sube tu certificado, o deja que QuiroFlow envíe por ti.',
      ),
      action: { label: t('Set up VeriFactu', 'Configurar VeriFactu'), to: '/settings/verifactu' },
    },
    {
      key: 'plan',
      group: 'account',
      done: store.comped || store.hasStripeSubscription,
      skippable: false,
      title: t('Choose your plan', 'Elige tu plan'),
      body:
        store.trialDaysLeft === 0
          ? t('Your trial ends today. Add a card so the clinic keeps running.', 'Tu prueba termina hoy. Añade una tarjeta para que la clínica siga funcionando.')
          : store.trialDaysLeft === 1
            ? t('Add a card before your trial ends in 1 day. Nothing is charged until then.', 'Añade una tarjeta antes de que acabe tu prueba, en 1 día. No se cobra nada hasta entonces.')
            : store.trialDaysLeft !== null
              ? t(
                  `Add a card before your trial ends in ${store.trialDaysLeft} days. Nothing is charged until then.`,
                  `Añade una tarjeta antes de que acabe tu prueba, en ${store.trialDaysLeft} días. No se cobra nada hasta entonces.`,
                )
              : t('Add a card so the clinic keeps running.', 'Añade una tarjeta para que la clínica siga funcionando.'),
      action: { label: t('Subscription', 'Suscripción'), to: '/subscription' },
    },
    {
      key: 'two_factor',
      group: 'account',
      done: facts.twoFactor,
      skippable: true,
      title: t('Two-factor login', 'Inicio de sesión en dos pasos'),
      body: t(
        'A code from an app on your phone after the password, so a leaked password alone does not open your patients’ records.',
        'Un código de una app del móvil después de la contraseña, para que una contraseña filtrada no abra sola las fichas de tus pacientes.',
      ),
      action: { label: t('Turn it on', 'Activar'), to: '/account' },
    },
    {
      key: 'first_visit',
      group: 'account',
      done: facts.firstVisit,
      skippable: false,
      title: t('Book your first visit', 'Reserva tu primera visita'),
      body: t(
        'Pick a slot in the calendar. Once WhatsApp and the reminder message above are set up, the reminder goes out on its own.',
        'Elige un hueco en la agenda. Cuando WhatsApp y el mensaje de recordatorio de arriba estén listos, el recordatorio sale solo.',
      ),
      action: { label: t('Open the calendar', 'Abrir la agenda'), to: '/calendar' },
    },
  ])

  const isSettled = (s: SetupStep) => s.done || (s.skippable && skipped.value.has(s.key))
  const settledCount = computed(() => steps.value.filter(isSettled).length)
  const total = computed(() => steps.value.length)
  const complete = computed(() => settledCount.value === total.value)

  return { loaded, failed, steps, skipped, skip, unskip, load, isSettled, settledCount, total, complete }
}
