// Why a visit was cancelled (appointments.cancellation_reason,
// 20261115172804), and the same list as the WhatsApp choices the AI
// receptionist offers when somebody cancels their first visit without saying
// why.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.

export const CANCELLATION_REASONS = ['another_time', 'later', 'feeling_better', 'unforeseen', 'price', 'other'] as const
export type CancellationReason = (typeof CANCELLATION_REASONS)[number]

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === 'string' && (CANCELLATION_REASONS as readonly string[]).includes(value)
}

export type ChoiceLanguage = 'es' | 'en' | 'fr'

/**
 * The choices as the patient reads them. WhatsApp caps a list row's title at
 * 24 characters (and refuses the whole message over it), so every one of
 * these fits; the unit test holds them to it.
 */
export const CANCELLATION_REASON_CHOICES: Record<ChoiceLanguage, Record<CancellationReason, string>> = {
  es: {
    another_time: 'Prefiero otro día u hora',
    later: 'Reservaré más adelante',
    feeling_better: 'Ya me encuentro mejor',
    unforeseen: 'Un imprevisto',
    price: 'Por el precio',
    other: 'Otro motivo',
  },
  en: {
    another_time: 'Another day or time',
    later: "I'll book later on",
    feeling_better: 'I feel better now',
    unforeseen: 'Something came up',
    price: 'The price',
    other: 'Another reason',
  },
  fr: {
    another_time: 'Un autre jour ou heure',
    later: 'Je réserverai plus tard',
    feeling_better: 'Je vais déjà mieux',
    unforeseen: 'Un imprévu',
    price: 'Le prix',
    other: 'Autre raison',
  },
}

/** The list's button, which opens it (WhatsApp: at most 20 characters). */
export const CANCELLATION_REASON_BUTTON: Record<ChoiceLanguage, string> = {
  es: 'Elegir motivo',
  en: 'Choose a reason',
  fr: 'Choisir',
}

/** The row id a tap comes back with: tells the webhook the tap answers this list and nothing else. */
export const CANCELLATION_REASON_ID_PREFIX = 'cancel_reason:'

/** The language the choices are written in: theirs when the list has it, else Spanish. */
export function choiceLanguage(preferred: string | null | undefined): ChoiceLanguage {
  const base = (preferred ?? '').split(/[_-]/)[0]!.toLowerCase()
  return base === 'en' || base === 'fr' ? base : 'es'
}

/** The WhatsApp list rows for cancellation reasons, in their language. */
export function cancellationReasonRows(language: ChoiceLanguage): { id: string; title: string }[] {
  return CANCELLATION_REASONS.map((reason) => ({ id: `${CANCELLATION_REASON_ID_PREFIX}${reason}`, title: CANCELLATION_REASON_CHOICES[language][reason] }))
}

/** The reason a tapped row stands for, or null when it is not one of ours. */
export function cancellationReasonFromRowId(id: string | null | undefined): CancellationReason | null {
  if (!id || !id.startsWith(CANCELLATION_REASON_ID_PREFIX)) return null
  const reason = id.slice(CANCELLATION_REASON_ID_PREFIX.length)
  return isCancellationReason(reason) ? reason : null
}

/** How the clinic's screens name a reason (the report). */
export function cancellationReasonLabel(reason: string | null, t: (en: string, es: string) => string): string {
  switch (reason) {
    case 'another_time': return t('Wanted another day', 'Quería otro día')
    case 'later': return t('Will book later', 'Reservará más adelante')
    case 'feeling_better': return t('Feeling better', 'Ya está mejor')
    case 'unforeseen': return t('Something came up', 'Un imprevisto')
    case 'price': return t('Price', 'Precio')
    case 'other': return t('Other reason', 'Otro motivo')
    default: return t('Not said', 'Sin motivo')
  }
}
