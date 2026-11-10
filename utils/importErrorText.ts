import { serverMessage } from './serverMessage'

/**
 * What to show when an import route refuses or fails, in the reader's
 * language.
 *
 * The import routes (server/api/import/*, server/utils/quirocitas.ts,
 * server/utils/practicehubV3.ts) answer in English only, and Settings › Import
 * used to put that text straight into a toast or an error line, so a clinic
 * working in Spanish was told "Quirocitas did not accept that username and
 * password." The messages a person can act on are restated here in both
 * languages. Anything else -- a database error, an unexpected status -- gets
 * the caller's plain sentence, with the raw text after it in brackets so it
 * can still be quoted to support.
 *
 * Keyed by the start of the server's text, so a message that carries a
 * detail at the end ("Quirocitas did not answer (timeout)") still matches.
 */
type Translate = (en: string, es: string) => string

const KNOWN: { starts: string; en: string; es: string }[] = [
  {
    starts: 'The PracticeHub 2.0 key starts with phk_',
    en: 'The PracticeHub 2.0 key starts with phk_. Create one in PracticeHub under Developers → API Keys.',
    es: 'La clave de PracticeHub 2.0 empieza por phk_. Créala en PracticeHub, en Developers → API Keys.',
  },
  {
    starts: 'That is a PracticeHub 2.0 key',
    en: 'That is a PracticeHub 2.0 key (it starts with phk_), so it goes in the "PracticeHub 2.0 API key" field. The API key field takes the Classic key, which does not start with phk_.',
    es: 'Esa es una clave de PracticeHub 2.0 (empieza por phk_), así que va en el campo "Clave API de PracticeHub 2.0". El campo Clave API lleva la clave Classic, que no empieza por phk_.',
  },
  {
    starts: 'The PracticeHub address is',
    en: 'The PracticeHub URL is the https:// address of your PracticeHub, for example https://your-clinic.practicehub.io',
    es: 'La URL de PracticeHub es la dirección https:// de tu PracticeHub, por ejemplo https://your-clinic.practicehub.io',
  },
  {
    starts: 'No PracticeHub connection is saved',
    en: 'No PracticeHub connection is saved. Save it in the Connection step first.',
    es: 'No hay ninguna conexión de PracticeHub guardada. Guárdala antes en el paso Conexión.',
  },
  // server/utils/practicehubClassic.ts, which puts PracticeHub's own refusals
  // into words: a 403 is a wrong key, a 404 or no answer is a wrong address.
  {
    starts: 'PracticeHub refused the API key',
    en: 'PracticeHub refused the API key. Check it under Developers → API Keys in PracticeHub and save it again in the Connection step.',
    es: 'PracticeHub rechazó la clave API. Compruébala en Developers → API Keys de PracticeHub y guárdala otra vez en el paso Conexión.',
  },
  {
    starts: 'Nothing answers at',
    en: 'Nothing answers at that address. Check the PracticeHub URL in the Connection step.',
    es: 'Nada responde en esa dirección. Comprueba la URL de PracticeHub en el paso Conexión.',
  },
  {
    starts: 'PracticeHub did not answer',
    en: 'PracticeHub did not answer. Check the address in the Connection step, or try again in a minute.',
    es: 'PracticeHub no respondió. Comprueba la dirección en el paso Conexión o vuelve a intentarlo en un minuto.',
  },
  {
    starts: 'PracticeHub is rate-limiting',
    en: 'PracticeHub is limiting how fast it answers. Wait a minute and try again.',
    es: 'PracticeHub está limitando la velocidad a la que responde. Espera un minuto y vuelve a intentarlo.',
  },
  {
    starts: 'No PracticeHub 2.0 connection is saved',
    en: 'No PracticeHub 2.0 key is saved. Add the phk_ key in the Connection step first.',
    es: 'No hay ninguna clave de PracticeHub 2.0 guardada. Añade la clave phk_ en el paso Conexión.',
  },
  {
    starts: 'The Quirocitas address is',
    en: 'The Quirocitas address is the https:// address you sign in at, for example https://quirocitas-yourclinic.es/chiro',
    es: 'La dirección de Quirocitas es la dirección https:// en la que inicias sesión, por ejemplo https://quirocitas-yourclinic.es/chiro',
  },
  { starts: 'Enter the Quirocitas username', en: 'Enter the Quirocitas username.', es: 'Escribe el usuario de Quirocitas.' },
  { starts: 'Save the Quirocitas connection first', en: 'Save the Quirocitas connection first.', es: 'Guarda antes la conexión con Quirocitas.' },
  {
    starts: 'Quirocitas did not accept that username and password',
    en: 'Quirocitas did not accept that username and password. Check them by signing in to Quirocitas yourself.',
    es: 'Quirocitas no aceptó ese usuario y contraseña. Compruébalos iniciando sesión tú en Quirocitas.',
  },
  {
    starts: 'Quirocitas did not answer',
    en: 'Quirocitas did not answer. Check the address, or try again in a minute.',
    es: 'Quirocitas no respondió. Comprueba la dirección o vuelve a intentarlo en un minuto.',
  },
  {
    starts: 'Quirocitas keeps asking to sign in again',
    en: 'Quirocitas keeps asking to sign in again. Someone may be using the same login elsewhere; try again in a minute.',
    es: 'Quirocitas pide iniciar sesión una y otra vez. Puede que alguien esté usando el mismo usuario en otro sitio; vuelve a intentarlo en un minuto.',
  },
  {
    starts: 'Quirocitas showed no patient list',
    en: 'Quirocitas showed no patient list. Check the address ends in /chiro and that this user can search patients.',
    es: 'Quirocitas no mostró ninguna lista de pacientes. Comprueba que la dirección termina en /chiro y que este usuario puede buscar pacientes.',
  },
]

/** The server's own text, from the response body (see utils/serverMessage.ts). */
function rawMessage(err: unknown): string | null {
  const fromBody = serverMessage(err)
  if (fromBody) return fromBody
  const message = (err as { message?: string } | null)?.message
  return message && message.trim() ? message : null
}

export function importErrorText(err: unknown, t: Translate, fallback: { en: string; es: string }): string {
  const raw = rawMessage(err)
  if (raw) {
    const known = KNOWN.find((k) => raw.startsWith(k.starts))
    if (known) return t(known.en, known.es)
  }
  const plain = t(fallback.en, fallback.es)
  return raw ? `${plain} (${raw})` : plain
}
