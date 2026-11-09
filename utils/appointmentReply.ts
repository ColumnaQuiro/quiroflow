// What a reply to an appointment confirmation or reminder means (the WhatsApp
// webhook applies it): confirmed, wants another time, cancelled, or none of
// those. The templates' own buttons come back as their titles, so every
// language a clinic writes a template in needs its buttons' words here -- a
// French "Confirmer" tap used to match nothing and leave the visit unconfirmed.

const CONFIRM_WORDS = ['confirmo', 'confirmar', 'confirmado', 'sí', 'si', 'yes', 'confirm', 'vale', 'ok', 'okay', 'confirmer', 'confirme', 'confirmé', 'oui']
const RESCHEDULE_WORDS = ['cambiar', 'cambio', 'reprogramar', 'reschedule', 'aplazar', 'posponer', 'mover', 'modifier', 'changer', 'reporter', 'déplacer', 'deplacer']
const CANCEL_WORDS = ['cancelar', 'cancelo', 'cancelado', 'anular', 'cancel', 'annuler', 'annule', 'annulé']

// Things a patient asks to change that are NOT their appointment. "Me
// gustaría cambiar el Mail que tenéis registrado con mi ficha" is the
// message that started this: it matched on "cambiar" alone and recorded a
// patient who had tapped Confirmar fourteen minutes earlier as wanting to
// move his visit.
//
// Excluding by the OBJECT of the verb rather than by where the verb sits in
// the sentence, because position turns out not to separate the two cases at
// all -- "La tengo que cambiar", "Me la puedes cambiar por la tarde", "Queria
// reprogramarla a la semana que viene" are all real requests that name the
// appointment only as "la", leaning on the reminder they are replying to.
// Anchoring the match to the start of the message would have thrown those
// away to catch this one. The French line is the same idea for "changer mon
// adresse e-mail".
const CHANGE_OF_SOMETHING_ELSE =
  /(cambiar|cambio|cambiarme|modificar)\s+(el\s+|la\s+|mi\s+|mis\s+)?(mail|email|correo|tel[eé]fono|movil|m[oó]vil|n[uú]mero|direcci[oó]n|nombre|apellido|dni|datos|ficha|contrase[nñ]a)|(changer|modifier)\s+(mon\s+|ma\s+|mes\s+|le\s+|la\s+|l')?(e-?mail|adresse|t[eé]l[eé]phone|num[eé]ro|nom|coordonn[eé]es|mot de passe)/

/**
 * Words that may stand beside a cancel word in a message that is only a
 * cancellation: "Cancelar la cita, por favor", "Annuler mon rendez-vous
 * merci". Never a day or a time -- "cancelar la del viernes" names a visit,
 * which is not necessarily the one the last reminder was about.
 */
const CANCEL_FILLER = new Set([
  'la', 'mi', 'cita', 'visita', 'sesion', 'por', 'favor', 'porfa', 'porfavor', 'gracias', 'muchas', 'please', 'the', 'my', 'appointment', 'thanks',
  'le', 'mon', 'rendez', 'vous', 'rdv', 'merci', 's', 'il', 'plait', 'quiero', 'querria', 'me', 'gustaria', 'necesito', 'tengo', 'que',
])

/** Words after an unaccented "si" that keep it a yes: "si gracias", "si alli estare". */
const SI_YES_TAIL = new Set(['gracias', 'vale', 'perfecto', 'claro', 'ok', 'alli', 'ahi', 'estare', 'voy', 'ire', 'confirmo', 'de', 'muchas', 'genial', 'por', 'porfa', 'nos', 'senor', 'senora'])

/** A word that turns a "sí" into something else: a condition, a doubt, a change. */
const NOT_A_PLAIN_YES = /(?<!\p{L})(?:no|pero|aunque|not|but|pas|mais|ne)(?!\p{L})/u

function plainWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * What a reply means for the visit it answers.
 *
 * A tap on one of the template's buttons is read by its opening word, as
 * always: its title is the button's own ("Cancelar cita", "Confirmar").
 *
 * Typed text is read more carefully, because the webhook acts on it before
 * anyone -- the receptionist or a person -- has read it:
 * - it is a cancellation only when the whole message is one. "Cancelar la
 *   del viernes, la del martes la mantengo" opened with "cancelar" and
 *   cancelled the visit the last reminder was about -- the Tuesday one. Left
 *   alone, the receptionist or the desk cancels the visit it names.
 * - it is a yes only when nothing in it takes the yes back. "Si no puedo ir,
 *   ¿qué hago?" opened with "si" and marked the visit confirmed, and the
 *   confirmation then outranked the change they asked for next. "Si" with no
 *   accent is a yes on its own or before a comma ("Si, gracias"), and "if"
 *   before a word ("si puedo ir...").
 */
export function appointmentReplyIntent(text: string, opts: { button?: boolean } = {}): 'confirmed' | 'reschedule_requested' | 'cancelled' | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const opensWith = (words: string[]) => words.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!') || t.startsWith(w + ',') || t.startsWith(w + '.'))
  if (opts.button) {
    if (opensWith(CANCEL_WORDS)) return 'cancelled'
    if (opensWith(CONFIRM_WORDS)) return 'confirmed'
  } else {
    const words = plainWords(t)
    const cancelWords = new Set(CANCEL_WORDS.map((w) => plainWords(w)[0]!))
    if (words.length && cancelWords.has(words[0]!) && words.slice(1).every((w) => CANCEL_FILLER.has(w))) return 'cancelled'
    const afterSi = /^si\s+(\p{L}+)/u.exec(t)?.[1]
    const conditionalSi = Boolean(afterSi && !SI_YES_TAIL.has(plainWords(afterSi)[0] ?? ''))
    if (opensWith(CONFIRM_WORDS) && !conditionalSi && !t.includes('?') && !NOT_A_PLAIN_YES.test(plainWords(t).join(' ')) && !opensWith(CANCEL_WORDS) && !RESCHEDULE_WORDS.some((w) => t.includes(w))) return 'confirmed'
  }
  if (RESCHEDULE_WORDS.some((w) => t.includes(w)) && !CHANGE_OF_SOMETHING_ELSE.test(t)) return 'reschedule_requested'
  return null
}
