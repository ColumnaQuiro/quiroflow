// What goes in a WhatsApp template's dynamic URL button blank.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

/**
 * The phone number shaped the way this button's blank wants it.
 *
 * Meta keeps the fixed half of the link and appends exactly what is sent, so
 * where the blank sits decides what to send. quiroads_welcome_message_3 is
 * `https://columnaquiro.com/oferta-primera-visita/{{1}}` -- the blank is the
 * whole query string, and its example is `.../?phone=3466767676`. Sending the
 * digits alone built `/oferta-primera-visita/34620335584`, a page that does
 * not exist: every lead the welcome drip sent the booking button to landed on
 * "Página no encontrada", and nothing failed anywhere, because Meta checks
 * only that a value is present.
 *
 * So the template's own example says what surrounds the number: whatever
 * comes before the digit run at the end of the example's blank is kept, and
 * the digits are this person's. A blank that is just the number (`?phone={{1}}`,
 * example `...?phone=3466767676`) gets the digits alone, as before.
 */
export function phoneForUrlButton(digits: string, url: string | null | undefined, example: string | null | undefined): string {
  const fixed = (url ?? '').split(/\{\{\d+\}\}/)[0] ?? ''
  if (!fixed || !example || !example.startsWith(fixed)) return digits
  const sample = example.slice(fixed.length)
  const shape = sample.match(/^(.*?)\+?\d{6,}$/)
  return shape ? `${shape[1]}${digits}` : digits
}
