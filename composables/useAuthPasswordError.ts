// The words for a refused password. Why it was refused is decided in
// utils/passwordRejection, which is pure and has its own spec.
//
// Five screens set a password -- staff signup, portal signup, the mobile
// signup, the reset page and the account page -- and all five printed
// Supabase's raw English at the person.
import { passwordRejection } from '../utils/passwordRejection'

export function useAuthPasswordError() {
  const t = useT()

  /**
   * A message worth showing, or the original when there is nothing better.
   *
   * Never returns empty: a failed submit that clears the error and says
   * nothing is worse than an awkward sentence.
   */
  return function authPasswordError(error: unknown): string {
    const fallback =
      (error as { message?: string } | null)?.message ||
      t('Something went wrong. Please try again.', 'Algo ha ido mal. Inténtalo de nuevo.')

    switch (passwordRejection(error)) {
      case 'pwned':
        return t(
          'That password has appeared in a known data breach, so it is not safe to use here. Please choose a different one — length matters more than symbols.',
          'Esa contraseña aparece en una filtración de datos conocida, así que no es segura. Elige otra distinta: la longitud importa más que los símbolos.',
        )
      case 'length':
        return t('That password is too short. Use at least 8 characters.', 'Esa contraseña es demasiado corta. Usa al menos 8 caracteres.')
      case 'characters':
        return t(
          'That password needs a wider mix of characters — letters, numbers or symbols.',
          'Esa contraseña necesita una mezcla más variada de caracteres: letras, números o símbolos.',
        )
      case 'weak':
        return t('That password is not accepted. Please choose a different one.', 'Esa contraseña no se acepta. Elige otra distinta.')
      default:
        return fallback
    }
  }
}
