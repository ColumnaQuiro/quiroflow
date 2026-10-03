// Supabase Auth's refusals on the sign-in and sign-up screens, in the app's
// language. Both printed error.message straight at the person -- "Invalid
// login credentials" to a Spanish clinic's front desk and its patients.
//
// Matched on auth-js's `code`, never on the sentence, for the reason
// utils/passwordRejection gives: the wording can change under us. A refused
// password is useAuthPasswordError's to word; anything not recognised here
// keeps Supabase's own message rather than an empty or vaguer one.
export function useAuthErrorMessage() {
  const t = useT()
  const authPasswordError = useAuthPasswordError()

  return function authErrorMessage(error: unknown): string {
    const err = (error ?? {}) as { code?: string; name?: string; status?: number }

    switch (err.code) {
      case 'invalid_credentials':
        return t('Wrong email or password.', 'El correo o la contraseña no son correctos.')
      case 'email_not_confirmed':
        return t(
          'Confirm your email first — open the link we sent you, then sign in.',
          'Confirma primero tu correo: abre el enlace que te enviamos y luego inicia sesión.',
        )
      case 'user_already_exists':
        return t('There is already an account with this email. Sign in instead.', 'Ya existe una cuenta con este correo. Inicia sesión.')
      case 'email_address_invalid':
        return t('That email address is not valid.', 'Ese correo electrónico no es válido.')
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return t('Too many attempts. Wait a few minutes and try again.', 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.')
      case 'signup_disabled':
        return t('New accounts cannot be created right now.', 'Ahora mismo no se pueden crear cuentas nuevas.')
    }

    // No response at all: the phone is offline or the server unreachable.
    if (err.name === 'AuthRetryableFetchError' || err.status === 0) {
      return t('Could not connect. Check your internet connection and try again.', 'No se ha podido conectar. Comprueba tu conexión a internet e inténtalo de nuevo.')
    }

    return authPasswordError(error)
  }
}
