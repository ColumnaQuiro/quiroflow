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

export function appointmentReplyIntent(text: string): 'confirmed' | 'reschedule_requested' | 'cancelled' | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const opensWith = (words: string[]) => words.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '!'))
  if (opensWith(CANCEL_WORDS)) return 'cancelled'
  if (opensWith(CONFIRM_WORDS)) return 'confirmed'
  if (RESCHEDULE_WORDS.some((w) => t.includes(w)) && !CHANGE_OF_SOMETHING_ELSE.test(t)) return 'reschedule_requested'
  return null
}
