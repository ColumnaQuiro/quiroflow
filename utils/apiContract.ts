// Facts about the public API that both sides need to agree on: the server
// enforces them, and the developer portal and Settings → Developers document
// and offer them.
//
// They live here rather than in server/utils/publicApi.ts because importing
// that file from a page would pull `#supabase/server` -- and with it the
// service-role client -- into the browser bundle. This module has no imports
// at all, so it's safe on either side, and there is still exactly one
// definition of each value.

export const API_VERSION = 'v1'
export const API_BASE_URL = `https://app.quiroflow.com/api/public/${API_VERSION}`

export const RATE_LIMIT_REQUESTS = 120
export const RATE_LIMIT_WINDOW_SECONDS = 60

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 100

// Deliberately coarse. A finer grid (patients:read.email and so on) reads
// well in docs and then nobody uses it, while every extra scope is another
// thing a clinic can get wrong when issuing a token. Read/write split per
// resource group is the line that actually matters.
export const API_SCOPES = [
  { key: 'patients:read', group: 'Patients', en: 'Read patients and their contact details', es: 'Leer pacientes y sus datos de contacto' },
  { key: 'patients:write', group: 'Patients', en: 'Create and update patients', es: 'Crear y actualizar pacientes' },
  { key: 'appointments:read', group: 'Appointments', en: 'Read appointments and availability', es: 'Leer citas y disponibilidad' },
  { key: 'appointments:write', group: 'Appointments', en: 'Book, reschedule and cancel appointments', es: 'Reservar, reprogramar y cancelar citas' },
  { key: 'catalog:read', group: 'Catalog', en: 'Read clinics, practitioners, appointment types and services', es: 'Leer clínicas, profesionales, tipos de cita y servicios' },
  { key: 'billing:read', group: 'Billing', en: 'Read invoices and payments', es: 'Leer facturas y pagos' },
  { key: 'whatsapp:send', group: 'Messaging', en: 'Send WhatsApp messages as the clinic', es: 'Enviar mensajes de WhatsApp en nombre de la clínica' },
  // For a forwarder (n8n, Zapier, your own backend) that relays Meta's webhook
  // on to /api/whatsapp/webhook. Meta's own signature cannot survive that hop
  // -- it is an HMAC over the exact bytes, and re-serialising the JSON breaks
  // it -- so the forwarder proves who it is with a token instead.
  { key: 'whatsapp:webhook', group: 'Messaging', en: 'Forward incoming WhatsApp webhooks to this clinic', es: 'Reenviar webhooks entrantes de WhatsApp a esta clínica' },
] as const

export type ApiScope = (typeof API_SCOPES)[number]['key']
export const API_SCOPE_KEYS = API_SCOPES.map((s) => s.key) as ApiScope[]
