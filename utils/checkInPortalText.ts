// What the front-desk check-in portal (pages/check-in/[token].vue) says, in
// each language a clinic in Spain is likely to meet at its desk. The location
// picks the tablet's own language in Settings; a patient can switch it on the
// screen, and it goes back after them.
//
// More than the public booking page's three (utils/bookingLanguage.ts): that
// page also drives WhatsApp templates, which have to exist in each language.
// The tablet only has these few lines.

export type PortalLanguage = 'es' | 'en' | 'fr' | 'de' | 'it' | 'pt' | 'ca'

export const PORTAL_LANGUAGES: readonly PortalLanguage[] = ['es', 'ca', 'en', 'fr', 'de', 'it', 'pt']

/** Each language named in itself, for the switcher on the tablet and the Settings picker. */
export const PORTAL_LANGUAGE_NAMES: Record<PortalLanguage, string> = {
  es: 'Español',
  ca: 'Català',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
}

export const PORTAL_LOCALES: Record<PortalLanguage, string> = { es: 'es-ES', ca: 'ca-ES', en: 'en-GB', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' }

export function isPortalLanguage(value: unknown): value is PortalLanguage {
  return typeof value === 'string' && (PORTAL_LANGUAGES as readonly string[]).includes(value)
}

export interface PortalText {
  loading: string
  offTitle: string
  offText: string
  welcomeTitle: string
  typeBirthDate: string
  typeNationalId: string
  nationalIdHint: string
  continue: string
  badNationalId: string
  orScan: string
  scan: string
  scanHint: string
  cameraUnavailable: string
  cancel: string
  day: string
  month: string
  year: string
  erase: string
  badDate: string
  searching: string
  failed: string
  chooseTitle: string
  chooseText: string
  chooseTextNationalId: string
  visitAt: (time: string) => string
  startOver: string
  notFoundTitle: string
  notFoundText: string
  tryAgain: string
  hello: (firstName: string) => string
  arrived: string
  alreadyArrived: string
  yourVisit: (time: string, practitioner: string | null) => string
  done: string
  language: string
}

export const PORTAL_TEXT: Record<PortalLanguage, PortalText> = {
  es: {
    loading: 'Cargando…',
    offTitle: 'El registro de llegada está desactivado',
    offText: 'Avisa en recepción de que has llegado.',
    welcomeTitle: '¡Bienvenido! Registra tu llegada',
    typeBirthDate: 'Escribe tu fecha de nacimiento',
    typeNationalId: 'Escribe tu DNI, NIE o pasaporte',
    nationalIdHint: 'Con la letra, sin espacios',
    continue: 'Continuar',
    badNationalId: 'Escribe tu DNI, NIE o pasaporte completo, con la letra.',
    orScan: 'o escanea el código QR de la app',
    scan: 'Escanear código QR',
    scanHint: 'Acerca el código QR de la app a la cámara.',
    cameraUnavailable: 'No se puede usar la cámara. Escribe tus datos en la pantalla.',
    cancel: 'Cancelar',
    day: 'Día',
    month: 'Mes',
    year: 'Año',
    erase: 'Borrar',
    badDate: 'Esa fecha no existe. Escríbela como día, mes y año: 070385 para el 7 de marzo de 1985.',
    searching: 'Buscando tu cita…',
    failed: 'No se ha podido registrar tu llegada. Avisa en recepción.',
    chooseTitle: '¿Cuál eres tú?',
    chooseText: 'Hay más de una cita con esa fecha de nacimiento.',
    chooseTextNationalId: 'Hay más de una cita con ese documento.',
    visitAt: (time) => `Cita a las ${time}`,
    startOver: 'Empezar de nuevo',
    notFoundTitle: 'No encontramos tu cita',
    notFoundText: 'No hay ninguna cita ahora mismo con esos datos. Compruébalos o avisa en recepción.',
    tryAgain: 'Volver a intentarlo',
    hello: (name) => (name ? `¡Hola, ${name}!` : '¡Hola!'),
    arrived: 'Llegada registrada. Toma asiento, te llamamos.',
    alreadyArrived: 'Ya habías registrado tu llegada. Toma asiento, te llamamos.',
    yourVisit: (time, who) => `Tu cita: ${time}${who ? ` con ${who}` : ''}`,
    done: 'Hecho',
    language: 'Idioma',
  },
  ca: {
    loading: 'Carregant…',
    offTitle: 'El registre d’arribada està desactivat',
    offText: 'Avisa a recepció que ja has arribat.',
    welcomeTitle: 'Benvingut! Registra la teva arribada',
    typeBirthDate: 'Escriu la teva data de naixement',
    typeNationalId: 'Escriu el teu DNI, NIE o passaport',
    nationalIdHint: 'Amb la lletra, sense espais',
    continue: 'Continuar',
    badNationalId: 'Escriu el teu DNI, NIE o passaport complet, amb la lletra.',
    orScan: 'o escaneja el codi QR de l’app',
    scan: 'Escanejar el codi QR',
    scanHint: 'Apropa el codi QR de l’app a la càmera.',
    cameraUnavailable: 'No es pot fer servir la càmera. Escriu les teves dades a la pantalla.',
    cancel: 'Cancel·lar',
    day: 'Dia',
    month: 'Mes',
    year: 'Any',
    erase: 'Esborrar',
    badDate: 'Aquesta data no existeix. Escriu-la com a dia, mes i any: 070385 per al 7 de març de 1985.',
    searching: 'Buscant la teva cita…',
    failed: 'No s’ha pogut registrar la teva arribada. Avisa a recepció.',
    chooseTitle: 'Quin ets tu?',
    chooseText: 'Hi ha més d’una cita amb aquesta data de naixement.',
    chooseTextNationalId: 'Hi ha més d’una cita amb aquest document.',
    visitAt: (time) => `Cita a les ${time}`,
    startOver: 'Tornar a començar',
    notFoundTitle: 'No trobem la teva cita',
    notFoundText: 'Ara mateix no hi ha cap cita amb aquestes dades. Comprova-les o avisa a recepció.',
    tryAgain: 'Tornar-ho a provar',
    hello: (name) => (name ? `Hola, ${name}!` : 'Hola!'),
    arrived: 'Arribada registrada. Seu, et cridarem.',
    alreadyArrived: 'Ja havies registrat la teva arribada. Seu, et cridarem.',
    yourVisit: (time, who) => `La teva cita: ${time}${who ? ` amb ${who}` : ''}`,
    done: 'Fet',
    language: 'Idioma',
  },
  en: {
    loading: 'Loading…',
    offTitle: 'Check-in is switched off',
    offText: 'Please let the front desk know you have arrived.',
    welcomeTitle: 'Welcome! Check in here',
    typeBirthDate: 'Enter your date of birth',
    typeNationalId: 'Enter your DNI, NIE or passport number',
    nationalIdHint: 'Including any letters, no spaces',
    continue: 'Continue',
    badNationalId: 'Enter your full DNI, NIE or passport number.',
    orScan: 'or scan the QR code in the app',
    scan: 'Scan QR code',
    scanHint: 'Hold the QR code from the app up to the camera.',
    cameraUnavailable: 'The camera cannot be used. Please enter your details on the screen.',
    cancel: 'Cancel',
    day: 'Day',
    month: 'Month',
    year: 'Year',
    erase: 'Delete',
    badDate: 'That date does not exist. Enter it as day, month and year: 070385 for 7 March 1985.',
    searching: 'Finding your appointment…',
    failed: 'We could not check you in. Please tell the front desk.',
    chooseTitle: 'Which one is you?',
    chooseText: 'More than one appointment has that date of birth.',
    chooseTextNationalId: 'More than one appointment has that ID number.',
    visitAt: (time) => `Appointment at ${time}`,
    startOver: 'Start over',
    notFoundTitle: 'We could not find your appointment',
    notFoundText: 'There is no appointment right now with those details. Check them or tell the front desk.',
    tryAgain: 'Try again',
    hello: (name) => (name ? `Hello, ${name}!` : 'Hello!'),
    arrived: 'You are checked in. Take a seat, we will call you.',
    alreadyArrived: 'You had already checked in. Take a seat, we will call you.',
    yourVisit: (time, who) => `Your appointment: ${time}${who ? ` with ${who}` : ''}`,
    done: 'Done',
    language: 'Language',
  },
  fr: {
    loading: 'Chargement…',
    offTitle: 'L’enregistrement des arrivées est désactivé',
    offText: 'Signalez votre arrivée à l’accueil.',
    welcomeTitle: 'Bienvenue ! Signalez votre arrivée',
    typeBirthDate: 'Saisissez votre date de naissance',
    typeNationalId: 'Saisissez votre DNI, NIE ou numéro de passeport',
    nationalIdHint: 'Avec les lettres, sans espaces',
    continue: 'Continuer',
    badNationalId: 'Saisissez votre DNI, NIE ou numéro de passeport complet.',
    orScan: 'ou scannez le code QR de l’application',
    scan: 'Scanner le code QR',
    scanHint: 'Présentez le code QR de l’application devant la caméra.',
    cameraUnavailable: 'La caméra n’est pas disponible. Saisissez vos informations à l’écran.',
    cancel: 'Annuler',
    day: 'Jour',
    month: 'Mois',
    year: 'Année',
    erase: 'Effacer',
    badDate: 'Cette date n’existe pas. Saisissez jour, mois et année : 070385 pour le 7 mars 1985.',
    searching: 'Recherche de votre rendez-vous…',
    failed: 'Votre arrivée n’a pas pu être enregistrée. Prévenez l’accueil.',
    chooseTitle: 'Lequel êtes-vous ?',
    chooseText: 'Plusieurs rendez-vous ont cette date de naissance.',
    chooseTextNationalId: 'Plusieurs rendez-vous ont ce numéro de document.',
    visitAt: (time) => `Rendez-vous à ${time}`,
    startOver: 'Recommencer',
    notFoundTitle: 'Nous ne trouvons pas votre rendez-vous',
    notFoundText: 'Aucun rendez-vous en ce moment avec ces informations. Vérifiez-les ou prévenez l’accueil.',
    tryAgain: 'Réessayer',
    hello: (name) => (name ? `Bonjour, ${name} !` : 'Bonjour !'),
    arrived: 'Arrivée enregistrée. Installez-vous, nous allons vous appeler.',
    alreadyArrived: 'Votre arrivée était déjà enregistrée. Installez-vous, nous allons vous appeler.',
    yourVisit: (time, who) => `Votre rendez-vous : ${time}${who ? ` avec ${who}` : ''}`,
    done: 'Terminé',
    language: 'Langue',
  },
  de: {
    loading: 'Wird geladen…',
    offTitle: 'Die Anmeldung ist ausgeschaltet',
    offText: 'Bitte melden Sie sich am Empfang.',
    welcomeTitle: 'Willkommen! Hier anmelden',
    typeBirthDate: 'Geben Sie Ihr Geburtsdatum ein',
    typeNationalId: 'Geben Sie Ihre DNI-, NIE- oder Reisepassnummer ein',
    nationalIdHint: 'Mit Buchstaben, ohne Leerzeichen',
    continue: 'Weiter',
    badNationalId: 'Geben Sie Ihre vollständige DNI-, NIE- oder Reisepassnummer ein.',
    orScan: 'oder scannen Sie den QR-Code aus der App',
    scan: 'QR-Code scannen',
    scanHint: 'Halten Sie den QR-Code aus der App vor die Kamera.',
    cameraUnavailable: 'Die Kamera kann nicht verwendet werden. Bitte geben Sie Ihre Daten am Bildschirm ein.',
    cancel: 'Abbrechen',
    day: 'Tag',
    month: 'Monat',
    year: 'Jahr',
    erase: 'Löschen',
    badDate: 'Dieses Datum gibt es nicht. Geben Sie Tag, Monat und Jahr ein: 070385 für den 7. März 1985.',
    searching: 'Ihr Termin wird gesucht…',
    failed: 'Die Anmeldung hat nicht geklappt. Bitte melden Sie sich am Empfang.',
    chooseTitle: 'Wer sind Sie?',
    chooseText: 'Mehrere Termine haben dieses Geburtsdatum.',
    chooseTextNationalId: 'Mehrere Termine haben diese Ausweisnummer.',
    visitAt: (time) => `Termin um ${time}`,
    startOver: 'Neu beginnen',
    notFoundTitle: 'Wir finden Ihren Termin nicht',
    notFoundText: 'Gerade gibt es keinen Termin mit diesen Angaben. Prüfen Sie sie oder melden Sie sich am Empfang.',
    tryAgain: 'Erneut versuchen',
    hello: (name) => (name ? `Hallo, ${name}!` : 'Hallo!'),
    arrived: 'Sie sind angemeldet. Nehmen Sie Platz, wir rufen Sie auf.',
    alreadyArrived: 'Sie waren bereits angemeldet. Nehmen Sie Platz, wir rufen Sie auf.',
    yourVisit: (time, who) => `Ihr Termin: ${time}${who ? ` bei ${who}` : ''}`,
    done: 'Fertig',
    language: 'Sprache',
  },
  it: {
    loading: 'Caricamento…',
    offTitle: 'La registrazione dell’arrivo è disattivata',
    offText: 'Avvisa la reception che sei arrivato.',
    welcomeTitle: 'Benvenuto! Registra il tuo arrivo',
    typeBirthDate: 'Inserisci la tua data di nascita',
    typeNationalId: 'Inserisci il tuo DNI, NIE o numero di passaporto',
    nationalIdHint: 'Con le lettere, senza spazi',
    continue: 'Continua',
    badNationalId: 'Inserisci il tuo DNI, NIE o numero di passaporto completo.',
    orScan: 'oppure scansiona il codice QR dell’app',
    scan: 'Scansiona il codice QR',
    scanHint: 'Avvicina il codice QR dell’app alla fotocamera.',
    cameraUnavailable: 'Non è possibile usare la fotocamera. Inserisci i tuoi dati sullo schermo.',
    cancel: 'Annulla',
    day: 'Giorno',
    month: 'Mese',
    year: 'Anno',
    erase: 'Cancella',
    badDate: 'Questa data non esiste. Inseriscila come giorno, mese e anno: 070385 per il 7 marzo 1985.',
    searching: 'Cerchiamo il tuo appuntamento…',
    failed: 'Non è stato possibile registrare il tuo arrivo. Avvisa la reception.',
    chooseTitle: 'Quale sei tu?',
    chooseText: 'Più appuntamenti hanno questa data di nascita.',
    chooseTextNationalId: 'Più appuntamenti hanno questo numero di documento.',
    visitAt: (time) => `Appuntamento alle ${time}`,
    startOver: 'Ricomincia',
    notFoundTitle: 'Non troviamo il tuo appuntamento',
    notFoundText: 'Al momento non c’è nessun appuntamento con questi dati. Controllali o avvisa la reception.',
    tryAgain: 'Riprova',
    hello: (name) => (name ? `Ciao, ${name}!` : 'Ciao!'),
    arrived: 'Arrivo registrato. Accomodati, ti chiameremo.',
    alreadyArrived: 'Avevi già registrato il tuo arrivo. Accomodati, ti chiameremo.',
    yourVisit: (time, who) => `Il tuo appuntamento: ${time}${who ? ` con ${who}` : ''}`,
    done: 'Fatto',
    language: 'Lingua',
  },
  pt: {
    loading: 'A carregar…',
    offTitle: 'O registo de chegada está desativado',
    offText: 'Avise a receção de que chegou.',
    welcomeTitle: 'Bem-vindo! Registe a sua chegada',
    typeBirthDate: 'Escreva a sua data de nascimento',
    typeNationalId: 'Escreva o seu DNI, NIE ou número de passaporte',
    nationalIdHint: 'Com as letras, sem espaços',
    continue: 'Continuar',
    badNationalId: 'Escreva o seu DNI, NIE ou número de passaporte completo.',
    orScan: 'ou leia o código QR da aplicação',
    scan: 'Ler código QR',
    scanHint: 'Aproxime o código QR da aplicação da câmara.',
    cameraUnavailable: 'Não é possível usar a câmara. Escreva os seus dados no ecrã.',
    cancel: 'Cancelar',
    day: 'Dia',
    month: 'Mês',
    year: 'Ano',
    erase: 'Apagar',
    badDate: 'Essa data não existe. Escreva dia, mês e ano: 070385 para 7 de março de 1985.',
    searching: 'A procurar a sua consulta…',
    failed: 'Não foi possível registar a sua chegada. Avise a receção.',
    chooseTitle: 'Qual é você?',
    chooseText: 'Há mais de uma consulta com essa data de nascimento.',
    chooseTextNationalId: 'Há mais de uma consulta com esse documento.',
    visitAt: (time) => `Consulta às ${time}`,
    startOver: 'Recomeçar',
    notFoundTitle: 'Não encontramos a sua consulta',
    notFoundText: 'Não há nenhuma consulta neste momento com esses dados. Verifique-os ou avise a receção.',
    tryAgain: 'Tentar de novo',
    hello: (name) => (name ? `Olá, ${name}!` : 'Olá!'),
    arrived: 'Chegada registada. Sente-se, nós chamamos.',
    alreadyArrived: 'Já tinha registado a sua chegada. Sente-se, nós chamamos.',
    yourVisit: (time, who) => `A sua consulta: ${time}${who ? ` com ${who}` : ''}`,
    done: 'Concluído',
    language: 'Idioma',
  },
}
