// An invented clinic, "Clínica Demo", for the receptionist evals. Nothing
// here is a real clinic, patient or practitioner: the conversations are the
// shapes of real incidents, with the people made up.
//
// Its appointment types follow how a real clinic sets them up -- a first
// visit, an ad's offer, a referral visit, a child's first visit, and the
// visits after, named without accents as clinics often type them -- because
// the type rules (typesForAudience) and their names are part of what is
// being tested.

import type { BusinessHours } from '~/utils/businessHours'
import type { PromptClinic } from '~/utils/receptionistClinic'
import type { SlotAppointment, SlotType } from '~/utils/receptionistSlots'

export const TIME_ZONE = 'Europe/Madrid'

/** Monday 16 Nov 2026, 09:00 in Madrid (UTC+1). */
export const NOW = new Date('2026-11-16T08:00:00Z')

export const CLINIC_ID = 'clinic-demo'

const hours: BusinessHours = {
  mon: [['09:00', '14:00'], ['15:00', '20:00']],
  tue: [['09:00', '14:00'], ['15:00', '20:00']],
  wed: [['09:00', '14:00'], ['15:00', '20:00']],
  thu: [['09:00', '14:00'], ['15:00', '20:00']],
  fri: [],
  sat: [],
  sun: [],
}

export const PRACTITIONERS = [
  { id: 'p-marta', name: 'Marta Ríos', businessHours: hours, clinicIds: [CLINIC_ID] },
  { id: 'p-laura', name: 'Laura Vidal', businessHours: hours, clinicIds: [CLINIC_ID] },
]

export const CLINIC = { id: CLINIC_ID, name: 'Clínica Demo', timeZone: TIME_ZONE, businessHours: hours }

export const CLINIC_DETAILS: PromptClinic[] = [
  { name: 'Clínica Demo', address: 'Calle Inventada 1, Valencia', phone: '+34 600 000 000', email: 'hola@clinicademo.example', clinicHours: hours, practitionerHours: [hours, hours] },
]

const type = (id: string, name: string, durationMinutes: number, priceCents: number, extra: Partial<SlotType> = {}): SlotType => ({
  id,
  name,
  durationMinutes,
  priceCents,
  bookableBy: 'all',
  forMinors: false,
  forReferrals: false,
  practitionerIds: [],
  ...extra,
})

export const TYPES = {
  first: type('t-first', 'Primera visita', 60, 7000, { stage: 'first_visit' }),
  offer: type('t-offer', 'Oferta Primera visita', 60, 5000, { stage: 'first_visit_offer' }),
  referral: type('t-referral', 'Primera Visita Referido', 60, 5000, { stage: 'first_visit', forReferrals: true }),
  child: type('t-child', 'Primera visita niño', 45, 5000, { stage: 'first_visit', forMinors: true }),
  adjustment: type('t-adjustment', 'Ajuste Quiropractico', 30, 5500, { stage: 'adjustment' }),
  maintenance: type('t-maintenance', 'Mantenimiento Quiropractico', 30, 5500, { stage: 'maintenance' }),
  report: type('t-report', 'Informe Quiropractico', 45, 6000, { stage: 'report' }),
}

export const ALL_TYPES: SlotType[] = Object.values(TYPES)

export const KNOWLEDGE = [
  { title: 'Qué incluye la primera visita', lines: ['Historial de salud, análisis postural y la primera sesión de quiropráctica. Dura entre 45 minutos y una hora.'] },
  { title: 'Pagos y seguros', lines: ['Se paga en la consulta, con tarjeta o en efectivo. No trabajamos con aseguradoras.'] },
  { title: 'Masaje', lines: ['No hacemos masajes: hacemos ajustes quiroprácticos.'] },
]

/** The diary: who is already booked when, so the free times are not the whole week. */
export const BOOKED: SlotAppointment[] = [
  { practitionerId: 'p-marta', starts_at: '2026-11-17T17:00:00Z', ends_at: '2026-11-17T17:30:00Z' },
  { practitionerId: 'p-marta', starts_at: '2026-11-18T16:00:00Z', ends_at: '2026-11-18T17:00:00Z' },
  { practitionerId: 'p-laura', starts_at: '2026-11-19T17:00:00Z', ends_at: '2026-11-19T18:00:00Z' },
]

export const PACKAGES = [{ name: 'Bono 10 sesiones', sessions: 10, priceCents: 45000, installments: [] }]
