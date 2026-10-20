import { appStoreUrl, playStoreUrl } from './appLinks'

// The message reception sends a patient who hasn't got the app yet: both
// store links and the clinic code they type once inside it. Written in the
// patient's own language rather than the staff member's, because it is the
// patient who reads it -- the same rule the WhatsApp templates follow (#820).

export interface AppInviteInput {
  firstName: string | null
  clinicName: string
  /** The clinic code, which is the account slug (Settings > App). */
  code: string
  /** patients.preferred_language; anything other than en/fr reads Spanish. */
  language: string | null
}

export function appInviteText(input: AppInviteInput): string {
  const ios = appStoreUrl()
  const android = playStoreUrl()
  const name = input.firstName?.trim()
  const lang = input.language === 'en' || input.language === 'fr' ? input.language : 'es'

  if (lang === 'en') {
    return [
      `${name ? `Hi ${name}, d` : 'D'}ownload the QuiroFlow app to see and manage your appointments at ${input.clinicName}:`,
      ...(ios ? [`iPhone: ${ios}`] : []),
      `Android: ${android}`,
      `Open it, enter the clinic code ${input.code} and create your account with the email we have for you.`,
    ].join('\n')
  }
  if (lang === 'fr') {
    return [
      `${name ? `Bonjour ${name}, t` : 'T'}éléchargez l'application QuiroFlow pour voir et gérer vos rendez-vous chez ${input.clinicName} :`,
      ...(ios ? [`iPhone : ${ios}`] : []),
      `Android : ${android}`,
      `Ouvrez-la, saisissez le code de la clinique ${input.code} et créez votre compte avec l'e-mail que nous avons pour vous.`,
    ].join('\n')
  }
  return [
    `${name ? `Hola ${name}, d` : 'D'}escarga la app QuiroFlow para ver y gestionar tus citas en ${input.clinicName}:`,
    ...(ios ? [`iPhone: ${ios}`] : []),
    `Android: ${android}`,
    `Ábrela, introduce el código de la clínica ${input.code} y crea tu cuenta con el correo que tenemos tuyo.`,
  ].join('\n')
}
