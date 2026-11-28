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
//   Mistral AI (added 18 Nov 2026) hosts in the EEA by default; its DPA
//   (legal.mistral.ai/terms/data-processing-addendum) uses SCCs for any
//   transfer out, and its own subprocessors are listed at
//   trust.mistral.ai/subprocessors. Whether it may train on the audio is an
//   account toggle (Admin > Privacy), so nothing is claimed about that here.
// Added 27 Nov 2026, after a review found three providers the code already
// used and this list did not name:
// - Brevo: the fallback server/utils/resend.ts sends through once Resend's
//   daily allowance is spent. A French company; help.brevo.com ("Data storage
//   location") places its databases in the EU only, so there is no transfer.
// - Amazon Web Services, directly: .github/workflows/backup-storage.yml
//   copies every stored file each night to a bucket in eu-north-1
//   (Stockholm). Until then AWS appeared only as what Supabase runs on.
// - GoCardless: each clinic connects its OWN GoCardless account by OAuth
//   (server/utils/gocardless.ts), so the contract is the clinic's.
//   gocardless.com/privacy/details names GoCardless SAS (France) as the
//   entity serving the EU and the United Kingdom as where most data is
//   processed. It states no transfer mechanism, so none is claimed here.
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
    name: 'Brevo',
    purpose: { en: 'Backup email provider', es: 'Proveedor de email de reserva' },
    location: { en: 'EU (France, Germany and Belgium)', es: 'UE (Francia, Alemania y Bélgica)' },
    basis: { en: 'Data stays in the EU', es: 'Los datos se quedan en la UE' },
    note: {
      en: 'Only for emails sent after the main provider\'s daily limit is reached',
      es: 'Solo para los emails que se envían cuando el proveedor principal llega a su límite diario',
    },
  },
  {
    name: 'Amazon Web Services',
    purpose: { en: 'Nightly backup copy of the files', es: 'Copia de seguridad nocturna de los archivos' },
    location: { en: 'EU (Sweden)', es: 'UE (Suecia)' },
    basis: { en: `Data stays in the EU · ${DPF.en}`, es: `Los datos se quedan en la UE · ${DPF.es}` },
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
    name: 'GoCardless',
    purpose: { en: 'Direct debit payments', es: 'Cobros por domiciliación bancaria' },
    location: { en: 'EU (France) and United Kingdom', es: 'UE (Francia) y Reino Unido' },
    basis: { en: 'The clinic\'s own agreement with GoCardless', es: 'El contrato de la propia clínica con GoCardless' },
    note: {
      en: 'Only if the clinic connects its own GoCardless account',
      es: 'Solo si la clínica conecta su propia cuenta de GoCardless',
    },
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
    name: 'Mistral AI',
    purpose: { en: 'Transcribing WhatsApp voice notes for the AI receptionist', es: 'Transcripción de notas de voz de WhatsApp para la recepcionista IA' },
    location: { en: 'EU (European Economic Area)', es: 'UE (Espacio Económico Europeo)' },
    basis: SCC,
    note: {
      en: 'Only voice notes, and only if the clinic turns the AI receptionist on',
      es: 'Solo las notas de voz, y solo si la clínica activa la recepcionista IA',
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
