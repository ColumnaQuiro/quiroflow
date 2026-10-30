// Every third party that processes a clinic's data on QuiroFlow's behalf, as
// /legal/security and /legal/privacy both list it. One list, so the two pages
// cannot disagree about who has the data or where it goes.
//
// Each line is a statement a clinic relies on for its own register of
// processing, so it says only what was checked on 29 Oct 2026:
// - regions: Supabase project eu-west-1, Netlify functions_region eu-west-1,
//   Sentry ingest.de.sentry.io, and Resend's sending domain, whose feedback MX
//   is us-east-1 -- email leaves the EU even though the database does not;
// - transfer basis: the EU-U.S. Data Privacy Framework list
//   (dataprivacyframework.gov) for Netlify, Resend, Meta, Stripe, Google and
//   Sentry. Supabase and Anthropic are NOT on it; both DPAs use the 2021 SCCs.
//   Apple is not on it either, and only ever receives a push token.
// A provider added to the app belongs here in the same change, and one whose
// region or certification changes has to be corrected here too.

export interface LegalText {
  en: string
  es: string
}

export interface Subprocessor {
  name: string
  purpose: LegalText
  location: LegalText
  basis: LegalText
  /** What it sees, when that is narrower than "whatever passes through". */
  note?: LegalText
}

const DPF: LegalText = { en: 'EU-U.S. Data Privacy Framework', es: 'Marco de Privacidad de Datos UE-EE. UU.' }
const SCC: LegalText = { en: 'Standard Contractual Clauses (EU 2021/914)', es: 'Cláusulas contractuales tipo (UE 2021/914)' }

export const LEGAL_SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Supabase',
    purpose: { en: 'Database, file storage and sign-in', es: 'Base de datos, archivos e inicio de sesión' },
    location: { en: 'EU (Ireland), on Amazon Web Services', es: 'UE (Irlanda), sobre Amazon Web Services' },
    basis: { en: `Data stays in the EU · ${SCC.en}`, es: `Los datos se quedan en la UE · ${SCC.es}` },
  },
  {
    name: 'Netlify',
    purpose: { en: 'Application servers and delivery of the web app', es: 'Servidores de la aplicación y entrega de la web' },
    location: { en: 'EU (Ireland) for the servers; global network for static files', es: 'UE (Irlanda) para los servidores; red global para los archivos estáticos' },
    basis: DPF,
  },
  {
    name: 'Resend',
    purpose: { en: 'Email: reminders, invoices, documents', es: 'Email: recordatorios, facturas, documentos' },
    location: { en: 'United States', es: 'Estados Unidos' },
    basis: DPF,
  },
  {
    name: 'Meta Platforms (WhatsApp)',
    purpose: { en: 'WhatsApp messages and Facebook lead ads', es: 'Mensajes de WhatsApp y anuncios de captación de Facebook' },
    location: { en: 'United States', es: 'Estados Unidos' },
    basis: DPF,
    note: { en: 'Only if the clinic connects WhatsApp or Facebook', es: 'Solo si la clínica conecta WhatsApp o Facebook' },
  },
  {
    name: 'Stripe',
    purpose: { en: 'Card payments and subscriptions', es: 'Pagos con tarjeta y suscripciones' },
    location: { en: 'EU (Ireland) and United States', es: 'UE (Irlanda) y Estados Unidos' },
    basis: DPF,
  },
  {
    name: 'Anthropic',
    purpose: { en: 'AI receptionist and AI reply drafts', es: 'Recepcionista IA y borradores de respuesta con IA' },
    location: { en: 'United States', es: 'Estados Unidos' },
    basis: SCC,
    note: {
      en: 'Only if the clinic turns these features on. Anthropic may not train models on this data, and deletes it within 30 days',
      es: 'Solo si la clínica activa estas funciones. Anthropic no puede entrenar modelos con estos datos y los borra en un máximo de 30 días',
    },
  },
  {
    name: 'Google (Firebase, Google Wallet)',
    purpose: { en: 'App push notifications; bono passes in Google Wallet', es: 'Notificaciones de la app; bonos en Google Wallet' },
    location: { en: 'United States', es: 'Estados Unidos' },
    basis: DPF,
  },
  {
    name: 'Apple',
    purpose: { en: 'Delivering notifications to iPhones and Apple Wallet', es: 'Entrega de notificaciones en iPhone y Apple Wallet' },
    location: { en: 'United States', es: 'Estados Unidos' },
    basis: { en: 'Apple Developer Program terms', es: 'Condiciones del Apple Developer Program' },
    note: {
      en: 'Wallet updates are an empty signal; the pass itself is fetched from QuiroFlow',
      es: 'Las actualizaciones de Wallet son un aviso vacío; el bono se descarga de QuiroFlow',
    },
  },
  {
    name: 'Sentry',
    purpose: { en: 'Error reports', es: 'Informes de errores' },
    location: { en: 'EU (Germany)', es: 'UE (Alemania)' },
    basis: DPF,
    note: {
      en: 'No patient data: request bodies, searches, cookies and IP addresses are removed first',
      es: 'Sin datos de pacientes: antes se quitan cuerpos de petición, búsquedas, cookies y direcciones IP',
    },
  },
]
