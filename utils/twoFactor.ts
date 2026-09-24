// GoTrue answers a wrong or stale authenticator code with "Invalid TOTP code
// entered", which tells a receptionist nothing about what to do next. The
// usual real cause is a code that rolled over while it was being typed, and
// the next most common is a phone whose clock has drifted -- TOTP is only as
// right as the clock that generates it.
export function twoFactorErrorText(message: string, t: (en: string, es: string) => string): string {
  if (/invalid|expired|totp/i.test(message)) {
    return t(
      "That code didn't work. Codes change every 30 seconds -- try the newest one, and check your phone's time is set automatically.",
      'Ese código no es válido. Los códigos cambian cada 30 segundos: prueba con el más reciente y comprueba que la hora del móvil se ajusta automáticamente.',
    )
  }
  return message
}
