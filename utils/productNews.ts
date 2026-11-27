// Novedades: what changed in QuiroFlow, newest first, shown at /novedades and
// in the top bar's panel (components/news/TopBarButton.vue).
//
// An entry goes in with the pull request that makes the change, so it ships
// in the same release and never announces something production does not run
// yet. Not everything gets one: only what a clinic would notice. Internal
// work -- importers for one clinic, app version bumps, refactors, speed-ups
// nobody sees -- stays out, or the page turns into a commit log.
//
// Writing one:
//   - `kind`: 'new' for something a clinic could not do before, 'improvement'
//     for something it does better, 'fix' for something that now works as it
//     should. Fixes are folded under one line per week, so keep them short.
//   - `title`, `body`, `steps`: [English, Spanish] pairs, like t() everywhere
//     else (scripts/i18n-extract.mjs reads them as pairs). Say what the
//     clinic can now do, in its words, not the code's.
//   - `where`: the screen it lives on, as the clinic would find it, and the
//     route the "Go there" button opens. Leave it out for a fix.
//   - `steps`: two or three, only when there is something to do. A change
//     that needs nothing switched on says so in one step.
//   - `featured`: at most two a week, for the headline features.
//   - `tag`: when the change is not for everyone -- an add-on, a plan, or an
//     app update it needs.

export type NewsKind = 'new' | 'improvement' | 'fix'

export type NewsArea =
  | 'calendar'
  | 'patients'
  | 'billing'
  | 'treatment'
  | 'online_booking'
  | 'receptionist'
  | 'messages'
  | 'automations'
  | 'team'
  | 'app'

export type NewsText = [en: string, es: string]

export interface NewsEntry {
  /** Unique and stable: it keys the row on screen. */
  id: string
  /** YYYY-MM-DD, the day the release carrying it was published. */
  date: string
  kind: NewsKind
  area: NewsArea
  title: NewsText
  body?: NewsText
  where?: { label: NewsText; to: string }
  steps?: NewsText[]
  featured?: boolean
  tag?: { label: NewsText; tone: 'info' | 'warning' }
}

export const NEWS_AREAS: Record<NewsArea, NewsText> = {
  calendar: ['Calendar', 'Calendario'],
  patients: ['Patients', 'Pacientes'],
  billing: ['Billing', 'Cobros'],
  treatment: ['Treatment', 'Tratamiento'],
  online_booking: ['Online booking', 'Reserva online'],
  receptionist: ['Receptionist', 'Recepcionista'],
  messages: ['WhatsApp and messages', 'WhatsApp y mensajes'],
  automations: ['Automations', 'Automatizaciones'],
  team: ['Team', 'Equipo'],
  app: ['App', 'App'],
}

// Any order: sorted newest first below.
const ENTRIES: NewsEntry[] = [
  {
    id: 'blind-spot',
    date: '2026-11-26',
    kind: 'new',
    area: 'treatment',
    featured: true,
    title: ['Blind Spot: the blind spot test', 'Blind Spot: la prueba de punto ciego'],
    body: [
      'Map the blind spot of each eye in the treatment room and keep every test on the patient record, so you can compare them visit by visit and hand the patient a report.',
      'Mide el punto ciego de cada ojo en la consulta y guarda cada prueba en la ficha, para compararlas visita a visita y darle al paciente un informe.',
    ],
    where: { label: ['Patient record › Blind spot', 'Ficha del paciente › Punto ciego'], to: '/patients' },
    steps: [
      ['Open a patient and go to the Blind spot tab.', 'Abre un paciente y entra en la pestaña Punto ciego.'],
      ['Run the test for each eye; it is saved with the date.', 'Haz la prueba de cada ojo; se guarda con su fecha.'],
    ],
    tag: { label: ['Blind Spot add-on', 'Complemento Blind Spot'], tone: 'info' },
  },
  {
    id: 'next-visit-time',
    date: '2026-11-26',
    kind: 'improvement',
    area: 'calendar',
    title: ['The calendar shows the time of the next appointment', 'El calendario muestra la hora de la próxima cita'],
    body: ['Not just its day.', 'No solo el día.'],
    where: { label: ['Calendar › an appointment', 'Calendario › una cita'], to: '/calendar' },
    steps: [['Nothing to switch on: open an appointment and the next one shows its day and time.', 'No hay que activar nada: abre una cita y la siguiente muestra día y hora.']],
  },
  {
    id: 'bono-discount',
    date: '2026-11-25',
    kind: 'new',
    area: 'billing',
    featured: true,
    title: ['Sell a bono at a special price', 'Vender un bono a precio especial'],
    body: [
      'Apply a discount when you sell a bono, on the web and in the app. The invoice shows the bono’s own price and the discount.',
      'Aplica un descuento al vender un bono, en la web y en la app. La factura muestra el precio del bono y el descuento.',
    ],
    where: { label: ['Charging a visit › Sell a bono', 'Cobrar la visita › Vender bono'], to: '/calendar' },
    steps: [
      ['Charge a visit, or open Billing on the patient record, and choose the bono to sell.', 'Cobra una visita, o abre Facturación en la ficha, y elige el bono que vendes.'],
      ['Tap “Apply a discount” and write the discounted price.', 'Pulsa «Aplicar descuento» y escribe el precio con descuento.'],
    ],
  },
  {
    id: 'day-hours',
    date: '2026-11-25',
    kind: 'new',
    area: 'team',
    title: ['Different hours for a single day', 'Horario especial de un solo día'],
    body: [
      'Open or close one date for a practitioner without touching their usual week. The calendar, online booking and the receptionist follow it.',
      'Abre o cierra un día concreto a un profesional sin tocar su semana habitual. La agenda, la reserva online y la recepcionista lo siguen.',
    ],
    where: { label: ['Settings › Team › the practitioner › Days with different hours', 'Ajustes › Equipo › el profesional › Días con horario especial'], to: '/settings/team' },
    steps: [
      ['Open Settings › Team and choose the practitioner.', 'Abre Ajustes › Equipo y elige al profesional.'],
      ['Under “Days with different hours”, tap “Add a day”.', 'En «Días con horario especial», pulsa «Añadir un día».'],
      ['Pick the date, choose Works or Day off, write the hours (09:30-14:00) and save.', 'Elige la fecha, marca Trabaja o No trabaja, escribe el horario (09:30-14:00) y guarda.'],
    ],
  },
  {
    id: 'posture-scale-weights',
    date: '2026-11-25',
    kind: 'improvement',
    area: 'treatment',
    title: ['Scale readings under each foot in posture', 'Pesos de báscula bajo cada pie en postura'],
    body: ['Optional, in “Where the weight falls”.', 'Opcional, en «Dónde cae el peso».'],
    where: { label: ['Posture › Where the weight falls', 'Postura › Dónde cae el peso'], to: '/patients' },
    steps: [['In a posture analysis, tap “Add scale readings” and write the weight on each foot.', 'En un análisis de postura, pulsa «Añadir pesos de báscula» y escribe el peso de cada pie.']],
  },
  {
    id: 'calendar-opening-hours-only',
    date: '2026-11-24',
    kind: 'improvement',
    area: 'calendar',
    title: ['Calendar: opening hours only', 'Calendario: solo horario de apertura'],
    body: ['The grid starts and ends with the clinic’s day, and remembers your display switches.', 'La rejilla empieza y acaba con el día de la clínica, y recuerda tus interruptores de vista.'],
    where: { label: ['Calendar › Display and key', 'Calendario › Visualización y leyenda'], to: '/calendar' },
    steps: [['Open “Display and key” in the calendar and switch on “Opening hours only”.', 'Abre «Visualización y leyenda» en el calendario y activa «Solo horario de apertura».']],
  },
  {
    id: 'invoice-by-whatsapp',
    date: '2026-11-24',
    kind: 'new',
    area: 'billing',
    title: ['Send receipts and invoices by WhatsApp', 'Enviar recibos y facturas por WhatsApp'],
    where: { label: ['Patient record › Billing', 'Ficha del paciente › Facturación'], to: '/patients' },
    steps: [['On the invoice or receipt, tap “Send by WhatsApp”.', 'En la factura o el recibo, pulsa «Enviar por WhatsApp».']],
  },
  {
    id: 'appointment-practitioner-variable',
    date: '2026-11-25',
    kind: 'improvement',
    area: 'automations',
    title: ['“Appointment practitioner” variable in automations', 'Variable «Profesional de la cita» en las automatizaciones'],
    where: { label: ['Automations', 'Automatizaciones'], to: '/automations' },
  },
  {
    id: 'fix-same-time-not-a-clash',
    date: '2026-11-25',
    kind: 'fix',
    area: 'calendar',
    title: ['Another appointment at the same time is no longer flagged as a clash.', 'Otra cita a la misma hora ya no se marca como choque.'],
  },
  {
    id: 'fix-receptionist-free-slot',
    date: '2026-11-25',
    kind: 'fix',
    area: 'receptionist',
    title: ['The receptionist no longer says there are no slots when one is left.', 'La recepcionista ya no dice que no hay huecos cuando queda uno.'],
  },
  {
    id: 'fix-whatsapp-form-link',
    date: '2026-11-25',
    kind: 'fix',
    area: 'messages',
    title: ['Form buttons in WhatsApp no longer lead to a broken link.', 'Los botones de formulario de WhatsApp ya no llevan a un enlace roto.'],
  },
]

export const PRODUCT_NEWS: NewsEntry[] = [...ENTRIES].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

/** Monday of the week `date` (YYYY-MM-DD) falls in, as YYYY-MM-DD. */
export function newsWeekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

// What a person who has never opened Novedades is shown as unread: the last
// fortnight, rather than every entry ever written.
const FIRST_VISIT_DAYS = 14

/** The entries `seenUpTo` (the newest date already seen) has not covered. */
export function unreadNews(entries: NewsEntry[], seenUpTo: string | null, today: string): NewsEntry[] {
  if (seenUpTo) return entries.filter((e) => e.date > seenUpTo)
  const from = new Date(`${today}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - FIRST_VISIT_DAYS)
  const cut = from.toISOString().slice(0, 10)
  return entries.filter((e) => e.date > cut)
}
