import type { Bilingual } from '~/utils/whatsappTemplateDraft'

/** The `error` object of a Graph API response, as Meta sends it. */
export interface MetaGraphError {
  code?: number | string
  error_subcode?: number | string
  message?: string
  error_user_title?: string
  error_user_msg?: string
}

// Meta's own words for the limit on editing an approved template. Since v16
// the error_subcode that would name it is no longer always sent, so the
// sentence is read too.
const EDIT_LIMIT_WORDS = /24[- ]hours?|once (a|per|every) day|daily limit|edit(ed|s|ing)? limit|limit.{0,40}edit|edit.{0,40}limit|can.?t be changed|status can.?t/i

const EDIT_LIMIT: Bilingual = {
  en: 'Meta will not let this template change right now. An approved template can be changed once a day and up to 10 times a month, and not while Meta is still reviewing it. Try again tomorrow.',
  es: 'Meta no deja cambiar esta plantilla ahora. Una plantilla aprobada se puede cambiar una vez al día y hasta 10 veces al mes, y no mientras Meta la está revisando. Inténtalo mañana.',
}

/**
 * What a clinic should be told when Meta refuses a template it is creating or
 * changing, in words it can act on, or null when Meta's refusal is not one we
 * recognise (the caller then shows Meta's own sentence).
 *
 * Codes from https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 * (read 24 Nov 2026). Meta writes its explanations in English; the front desk
 * reads Spanish.
 */
export function templateMetaProblem(error: MetaGraphError | null | undefined): Bilingual | null {
  if (!error) return null
  const code = Number(error.code)
  const sub = Number(error.error_subcode)
  const is = (n: number) => code === n || sub === n
  const words = [error.error_user_title, error.error_user_msg, error.message].filter(Boolean).join(' ')

  // 2388039: "Message template status can't be changed" -- still in review,
  // or the edit limit an approved template has.
  if (is(2388039)) return EDIT_LIMIT
  if (is(2388024)) {
    return {
      en: 'There is already a template with this name in this language. Choose another title.',
      es: 'Ya hay una plantilla con este nombre en este idioma. Elige otro título.',
    }
  }
  if (is(2388019)) {
    return {
      en: 'This WhatsApp account has reached the most templates Meta allows. Delete some you no longer use.',
      es: 'Esta cuenta de WhatsApp ha llegado al máximo de plantillas que permite Meta. Elimina alguna que ya no uséis.',
    }
  }
  if (is(2388040)) {
    return {
      en: 'Some text is longer than Meta allows. Shorten it.',
      es: 'Algún texto es más largo de lo que permite Meta. Acórtalo.',
    }
  }
  if (is(2388047)) {
    return {
      en: 'Meta did not accept what is at the top of the message. Check the heading or the file.',
      es: 'Meta no ha aceptado lo que va arriba del mensaje. Revisa el título o el archivo.',
    }
  }
  if (is(2388072)) {
    return {
      en: 'Meta did not accept the message text. Check the variables: {{1}}, {{2}}… in order, with none skipped.',
      es: 'Meta no ha aceptado el texto del mensaje. Revisa las variables: {{1}}, {{2}}… en orden y sin saltarse ninguna.',
    }
  }
  if (is(2388073)) {
    return {
      en: 'Meta did not accept the footer. A footer cannot have variables.',
      es: 'Meta no ha aceptado el pie. El pie no puede llevar variables.',
    }
  }
  if (is(2388293)) {
    return {
      en: 'The message has too many variables for its length. Add more text or remove a variable.',
      es: 'El mensaje tiene demasiadas variables para lo que dice. Añade más texto o quita alguna variable.',
    }
  }
  if (is(2388299)) {
    return {
      en: 'The message cannot start or end with a variable. Add some words before or after it.',
      es: 'El mensaje no puede empezar ni terminar con una variable. Añade alguna palabra antes o después.',
    }
  }
  // Meta's sentence, when no code names it: after the codes above, so a
  // character limit that happens to mention editing is not taken for it.
  if (EDIT_LIMIT_WORDS.test(words)) return EDIT_LIMIT
  if (code === 190) {
    return {
      en: 'The connection to WhatsApp has expired. Connect it again in Settings › WhatsApp.',
      es: 'La conexión con WhatsApp ha caducado. Vuelve a conectarla en Ajustes › WhatsApp.',
    }
  }
  if (code === 10 || code === 200) {
    return {
      en: 'The WhatsApp connection does not have permission to manage templates. Connect it again in Settings › WhatsApp.',
      es: 'La conexión con WhatsApp no tiene permiso para gestionar plantillas. Vuelve a conectarla en Ajustes › WhatsApp.',
    }
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80008) {
    return {
      en: 'WhatsApp is receiving too many requests. Wait a few minutes and try again.',
      es: 'WhatsApp está recibiendo demasiadas peticiones. Espera unos minutos y vuelve a intentarlo.',
    }
  }
  return null
}
