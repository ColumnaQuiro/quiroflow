// Demo content for the onboarding right panel.
//
// Everything here is invented and never reaches the API: onboarding runs
// before an account exists, so there is nothing real to show and nothing to
// query. Keeping it in one file is what stops plausible-looking fake patients
// leaking into a component someone later reuses on a real screen.
//
// Dates are fixed rather than computed from `new Date()`. These pages
// server-render, and a week derived at render time can differ between the
// server and the client across midnight, which hydrates as a mismatch. A
// preview of a product does not need to be on today's date.

export type PreviewTone = 'brand' | 'success' | 'neutral'

export interface PreviewAppointment {
  /** 0 = Monday, 4 = Friday. */
  day: number
  /** 0 = 09:00, 4 = 13:00. */
  slot: number
  patient: string
  detail: string
  tone: PreviewTone
}

export const PREVIEW_WEEK = { label: 'Week of 21 Sep', labelEs: 'Semana del 21 sep' }

export const PREVIEW_DAYS = [
  { name: 'Mon', nameEs: 'Lun', date: '21' },
  { name: 'Tue', nameEs: 'Mar', date: '22' },
  { name: 'Wed', nameEs: 'Mié', date: '23' },
  { name: 'Thu', nameEs: 'Jue', date: '24' },
  { name: 'Fri', nameEs: 'Vie', date: '25' },
]

export const PREVIEW_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00']

export const PREVIEW_APPOINTMENTS: PreviewAppointment[] = [
  { day: 0, slot: 0, patient: 'Lucía Ferrer', detail: 'Adjustment · Sala 1', tone: 'brand' },
  { day: 2, slot: 0, patient: 'Paula Marín', detail: 'Initial Assessment · Sala 2', tone: 'success' },
  { day: 1, slot: 1, patient: 'Nerea Sanz', detail: 'Adjustment · Sala 1', tone: 'brand' },
  { day: 4, slot: 1, patient: 'Hugo Peris', detail: 'Adjustment · Sala 2', tone: 'brand' },
  { day: 0, slot: 2, patient: 'Marc Oliver', detail: 'Initial Assessment · Sala 2', tone: 'success' },
  { day: 3, slot: 2, patient: 'Clara Vidal', detail: 'Adjustment · Sala 1', tone: 'brand' },
  { day: 1, slot: 3, patient: 'David Roca', detail: 'Follow-up · Sala 1', tone: 'neutral' },
  { day: 4, slot: 3, patient: 'Blocked', detail: 'Clinic admin', tone: 'neutral' },
  { day: 2, slot: 4, patient: 'Iván Torres', detail: 'Adjustment · Sala 1', tone: 'brand' },
]

export const PREVIEW_PATIENT = {
  name: 'Lucía Ferrer',
  initials: 'LF',
  phone: '+34 611 23 45 67',
  since: 'Aug 2025',
  sinceEs: 'ago 2025',
  next: 'Tue 09:00',
  nextEs: 'mar 09:00',
  totalBilled: '€155,00',
  visits: [
    { date: '14 Sep', service: 'Adjustment · Lea Guido · Sala 1', amount: '€45,00' },
    { date: '31 Aug', service: 'Adjustment · Lea Guido · Sala 2', amount: '€45,00' },
    { date: '17 Aug', service: 'Initial Assessment · Lea Guido · Sala 1', amount: '€65,00' },
  ],
  note: {
    date: '14 Sep',
    body: 'Cervical rotation improved to near full range on the right. Continued home exercise, three sets daily. Reassess in two weeks; no red flags.',
    bodyEs:
      'La rotación cervical ha mejorado hasta casi el rango completo por la derecha. Continúa con los ejercicios en casa, tres series diarias. Revisión en dos semanas; sin señales de alarma.',
  },
  invoice: { number: '2026-0142', amount: '€45,00' },
}

/** The step 3 reminder thread, in whichever language the clinic just picked. */
export const PREVIEW_THREAD = {
  en: {
    badge: 'Reminder · 24 h',
    outbound:
      'Hi Lucía, a reminder of your appointment at {clinic}: Tuesday 22 September at 09:00 — Adjustment with Lea Guido, Sala 1.',
    instruction: 'Reply {confirm} or {change}.',
    confirm: 'CONFIRM',
    change: 'RESCHEDULE',
    sentAt: 'Sent 21 Sep · 18:40',
    reply: 'CONFIRM',
    replyAt: '18:42',
    confirmed: 'Appointment confirmed',
    confirmedDetail: '— the calendar updated itself',
    followUp:
      'Thanks, Lucía. See you at Carrer de Sorní 12, Valencia. Arrive 5 minutes early if this is your first visit.',
    alsoEmail: 'Also by email',
    template: 'Template: Appointment reminder (EN)',
  },
  es: {
    badge: 'Recordatorio · 24 h',
    outbound:
      'Hola Lucía, te recordamos tu cita en {clinic}: martes 22 de septiembre a las 09:00 — Ajuste con Lea Guido, Sala 1.',
    instruction: 'Responde {confirm} o {change}.',
    confirm: 'CONFIRMAR',
    change: 'CAMBIAR',
    sentAt: 'Enviado 21 sep · 18:40',
    reply: 'CONFIRMAR',
    replyAt: '18:42',
    confirmed: 'Cita confirmada',
    confirmedDetail: '— la agenda se ha actualizado sola',
    followUp:
      'Gracias, Lucía. Te esperamos en Carrer de Sorní 12, Valencia. Llega 5 minutos antes si es tu primera visita.',
    alsoEmail: 'También por email',
    template: 'Plantilla: Recordatorio de cita (ES)',
  },
}

/** Neutral stand-ins for step 2's live-bound preview before anything is typed. */
export const PREVIEW_PLACEHOLDERS = {
  practice: { en: 'Your practice', es: 'Tu consulta' },
  location: { en: 'Your first clinic', es: 'Tu primera clínica' },
}

/**
 * The booking-URL slug. Mirrors how a clinic slug is built elsewhere: accents
 * folded, anything non-alphanumeric collapsed to a single hyphen.
 */
export function previewSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
