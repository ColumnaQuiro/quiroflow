// QuiroFlow's own email templates, offered beside the clinic's saved ones in
// the email editor's Templates tab. Written in Spanish, for a chiropractic
// clinic, like the automation templates (utils/automationTemplates.ts); the
// clinic changes the words before using one. An image block is left empty
// on purpose: an empty image sends nothing, and the editor shows where one
// can go.

import { blockId, type EmailBlock, type EmailDesign } from './emailDesign'
import type { Pair } from './automationCatalog'

export interface EmailStarter {
  key: string
  name: Pair
  description: Pair
  subject: string
  design: () => EmailDesign
}

const header = (): EmailBlock => ({ id: blockId(), type: 'header', align: 'center' })
const heading = (text: string): EmailBlock => ({ id: blockId(), type: 'heading', text, align: 'left' })
const text = (html: string): EmailBlock => ({ id: blockId(), type: 'text', html })
const image = (): EmailBlock => ({ id: blockId(), type: 'image', src: '', alt: '', link: null })
const button = (label: string, kind: 'booking' | 'review' = 'booking'): EmailBlock => ({ id: blockId(), type: 'button', text: label, link: { kind }, align: 'center' })
const footer = (): EmailBlock => ({ id: blockId(), type: 'footer', html: '<p>{{clinic_name}}<br>{{clinic_address}}<br>{{clinic_phone}}</p>' })

export const EMAIL_STARTERS: EmailStarter[] = [
  {
    key: 'letter',
    name: ['Plain letter', 'Carta sencilla'],
    description: ['A greeting, your words and the footer. Reads like a personal email.', 'Un saludo, tus palabras y el pie. Se lee como un email personal.'],
    subject: '{{first_name}}, un mensaje de {{clinic_name}}',
    design: () => ({
      version: 1,
      blocks: [
        text('<p>Hola {{first_name}}:</p><p>Escribe aquí tu mensaje.</p><p>Un saludo,<br>{{practitioner_first_name}}</p>'),
        footer(),
      ],
    }),
  },
  {
    key: 'check_up',
    name: ['Check-up reminder', 'Recordatorio de revisión'],
    description: ['For someone whose next visit is due. One clear button to book.', 'Para quien le toca volver. Un botón claro para reservar.'],
    subject: '{{first_name}}, ¿cómo va esa espalda?',
    design: () => ({
      version: 1,
      preheader: 'Han pasado unos meses desde tu última visita',
      blocks: [
        header(),
        heading('Hola {{first_name}}, hace tiempo que no te vemos'),
        text('<p>Tu última visita fue en {{last_visit_month}}. Si la espalda vuelve a avisar, mejor no esperar: {{practitioner_first_name}} tiene huecos esta semana.</p>'),
        button('Reservar mi cita'),
        footer(),
      ],
    }),
  },
  {
    key: 'newsletter',
    name: ['Newsletter', 'Boletín'],
    description: ['A picture, news from the clinic and two things side by side.', 'Una imagen, noticias de la clínica y dos cosas una al lado de la otra.'],
    subject: 'Novedades de {{clinic_name}}',
    design: () => ({
      version: 1,
      blocks: [
        header(),
        image(),
        heading('Este mes en la clínica'),
        text('<p>Cuéntales qué hay de nuevo: un horario, una persona nueva en el equipo, un consejo para la postura en el trabajo.</p>'),
        {
          id: blockId(),
          type: 'columns',
          columns: [
            { image: null, html: '<p><b>Consejo del mes</b></p><p>Una pausa de dos minutos cada hora delante del ordenador.</p>' },
            { image: null, html: '<p><b>Horario</b></p><p>Abrimos también los sábados por la mañana.</p>' },
          ],
        },
        button('Reservar una cita'),
        footer(),
      ],
    }),
  },
  {
    key: 'offer',
    name: ['Offer or bono', 'Oferta o bono'],
    description: ['An offer with its conditions in small print under the button.', 'Una oferta con sus condiciones en letra pequeña bajo el botón.'],
    subject: '{{first_name}}, una propuesta para ti',
    design: () => ({
      version: 1,
      blocks: [
        header(),
        image(),
        heading('Bono de 10 sesiones'),
        text('<p>Para seguir con tu plan de cuidado con un precio mejor por sesión.</p>'),
        button('Lo quiero'),
        { id: blockId(), type: 'divider' },
        text('<p>Válido hasta fin de mes. Pregunta en recepción por las condiciones.</p>'),
        footer(),
      ],
    }),
  },
]
