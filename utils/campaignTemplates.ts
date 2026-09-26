// A starter set of campaigns, so a new clinic does not begin at "No campaigns
// yet" with a blank editor.
//
// These are the eight ColumnaQuiro wrote and has been running, generalised.
// Three things had to change before they could be handed to anyone else:
//
//   - The clinic's own name, phone number and street address were written into
//     the copy. Name and address come from the clinic record now; there is no
//     clinic-wide phone field anywhere in the schema, so the sentences that
//     relied on one were rewritten to say "reply to this email", which every
//     clinic can honour.
//   - The filters carried appointment_type_ids as UUIDs -- ColumnaQuiro's
//     own. Those mean nothing in another database, so the appointment-type
//     filters are dropped and the picker says so. Everything portable
//     (total_visits, no_prior_appointments, has_future_appointment) is kept.
//   - One body was PracticeHub-era HTML: inline practicehub-font styling on
//     every paragraph, an <img> pointing at the clinic's own CDN, and a
//     hardcoded clinic code. Rewritten as plain paragraphs.
//
// Bodies are the small tag set components/automations/RichTextEditor.vue
// produces (p/ul/li/strong/br/a), because that is what the editor has to be
// able to reopen and what runAutomationActions injects unescaped.

export interface CampaignTemplate {
  /** Stable, so "already added" survives a clinic renaming the rule. */
  key: string
  name: { en: string; es: string }
  /** One line in the picker: what it does and when. */
  description: { en: string; es: string }
  triggerEvent: string
  isMarketing: boolean
  /**
   * Only portable keys -- never an id from another clinic's database.
   *
   * Typed as the same Json the column holds rather than Record<string,
   * unknown>, which will not narrow to it on insert.
   */
  filters: Record<string, string | number | boolean>
  subject: { en: string; es: string }
  body: { en: string; es: string }
}

/**
 * Placeholders resolved when the campaign is created, NOT merge fields.
 *
 * {{first_name}} and friends are resolved per-recipient at send time and must
 * survive into the saved body untouched. These two are facts about the clinic
 * that are already known, so they are substituted once and the staff member
 * sees finished copy in the editor rather than a puzzle.
 */
export function fillClinicPlaceholders(text: string, clinic: { name: string; address?: string | null }): string {
  return text
    .replaceAll('{{clinic_name}}', clinic.name)
    // The address sits alone in its own paragraph, so with none on file the
    // paragraph goes rather than leaving an empty one. Substituted as-is and
    // never wrapped in a sentence: an earlier version wrote "Estamos en ..."
    // around it, which put Spanish into the English body.
    .replace(/<p>\s*\{\{clinic_address\}\}\s*<\/p>\s*/g, clinic.address ? `<p>${clinic.address}</p>` : '')
    .replaceAll('{{clinic_address}}', clinic.address ?? '')
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    key: 'first-visit-booked',
    name: { en: 'First visit booked', es: 'Primera visita agendada' },
    description: {
      en: 'Welcomes a brand new patient when they book, and tells them how to prepare.',
      es: 'Da la bienvenida a un paciente nuevo al reservar y le explica cómo prepararse.',
    },
    triggerEvent: 'appointment.booked',
    isMarketing: false,
    filters: { no_prior_appointments: true },
    subject: {
      en: 'Welcome to {{clinic_name}} — your first visit is confirmed',
      es: '¡Bienvenido/a a {{clinic_name}}! Tu primera visita está confirmada',
    },
    body: {
      en: `<p>Welcome to our chiropractic practice!</p>
<p>Your first visit is booked for <strong>{{next_appointment}}</strong>.</p>
<p>The session lasts about an hour: a full assessment to understand your needs and goals, followed by your first chiropractic adjustment.</p>
<p>To make the most of it:</p>
<ul>
<li>Arrive five minutes early in case there is paperwork to complete.</li>
<li>Bring any relevant medical history — recent X-rays, reports, and a list of medication you are taking.</li>
<li>Wear comfortable clothing you can move easily in.</li>
</ul>
<p>If you need to reschedule, please let us know at least 24 hours beforehand by replying to this email.</p>
<p>{{clinic_address}}</p>
<p>Thank you for choosing us. We look forward to meeting you.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>¡Bienvenido/a a nuestra consulta quiropráctica!</p>
<p>Tu primera visita está reservada para el <strong>{{next_appointment}}</strong>.</p>
<p>La sesión durará aproximadamente una hora: haremos una evaluación completa para entender tus necesidades y objetivos, y a continuación realizaremos el primer ajuste quiropráctico.</p>
<p>Para aprovecharla al máximo, te recomendamos:</p>
<ul>
<li>Llegar cinco minutos antes por si hay algún papeleo que completar.</li>
<li>Traer cualquier historial médico relevante: radiografías recientes, informes y una lista de los medicamentos que tomas.</li>
<li>Vestir ropa cómoda que te permita moverte con facilidad.</li>
</ul>
<p>Si necesitas reprogramar tu cita, avísanos con al menos 24 horas de antelación respondiendo a este correo.</p>
<p>{{clinic_address}}</p>
<p>Gracias por elegirnos. ¡Esperamos verte pronto!</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'first-visit-cancelled',
    name: { en: 'First visit cancelled', es: 'Cancelación primera visita' },
    description: {
      en: 'Invites a patient to rebook after cancelling a first visit they never attended.',
      es: 'Invita a reprogramar tras cancelar una primera visita a la que nunca llegó a venir.',
    },
    triggerEvent: 'appointment.cancelled',
    isMarketing: false,
    filters: { total_visits: 0 },
    subject: { en: 'Shall we rebook your first visit?', es: '¿Reprogramamos tu primera visita?' },
    body: {
      en: `<p>Hi {{first_name}},</p>
<p>We saw you had to cancel your first visit. No problem at all — things come up.</p>
<p>We just wanted to say that whatever made you book in the first place is still there, and the sooner we look at it the sooner you will start feeling better.</p>
<p>Reply to this email and we will find a time that works.</p>
<p>Was it the timing, or is there something else we can help you decide on? Either way, just tell us.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>Hola {{first_name}},</p>
<p>Vimos que tuviste que cancelar tu primera visita. Sin problema, a veces surgen imprevistos.</p>
<p>Solo queríamos recordarte que el motivo por el que diste el primer paso sigue ahí, y cuanto antes lo abordemos, antes empezarás a sentirte mejor.</p>
<p>Responde a este correo y buscamos un hueco que te venga bien.</p>
<p>¿Fue por tema de horario o hay algo más en lo que podamos ayudarte a decidir? Cuéntanoslo y lo vemos juntos.</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'post-first-visit',
    name: { en: 'After the first visit', es: 'Post primera visita' },
    description: {
      en: 'Thanks the patient after their first visit and recaps what was done.',
      es: 'Agradece la primera visita y resume lo que se hizo en ella.',
    },
    triggerEvent: 'appointment.completed',
    isMarketing: false,
    filters: { total_visits: 1 },
    subject: { en: 'Thank you for your first visit', es: 'Gracias por tu primera visita' },
    body: {
      en: `<p>Hello {{first_name}},</p>
<p>Your path towards better overall health has begun.</p>
<p>We hope your first visit went well. Here is what we covered:</p>
<ul>
<li><strong>Initial assessment:</strong> we went through your full health history to understand your condition and what you need.</li>
<li><strong>Postural and nervous system analysis:</strong> tests to measure the state of your nervous system and spine.</li>
<li><strong>Chiropractic adjustment:</strong> a personalised adjustment to begin aligning your spine and improving how you feel.</li>
</ul>
<p>We would love to know how you feel after that first adjustment — just reply to this email.</p>
<p>Thank you for letting us be part of your journey. See you at your next session.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>Muy buenas, {{first_name}},</p>
<p>Tu camino hacia una mejor salud integral ha comenzado :)</p>
<p>Esperamos que hayas tenido una experiencia positiva en tu primera visita. Estos son los pasos que hemos revisado:</p>
<ul>
<li><strong>Evaluación inicial:</strong> revisamos tu historial de salud completo para comprender mejor tu condición y tus necesidades.</li>
<li><strong>Análisis postural y del sistema nervioso:</strong> pruebas para medir el estado de tu sistema nervioso y de la columna vertebral.</li>
<li><strong>Ajuste quiropráctico:</strong> un ajuste personalizado para comenzar a alinear tu columna y mejorar tu bienestar.</li>
</ul>
<p>Nos encantaría saber cómo te sientes después de tu primer ajuste. Cuéntanoslo respondiendo a este correo.</p>
<p>Gracias por permitirnos ser parte de tu camino. Esperamos verte pronto en tu próxima sesión.</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'what-to-expect',
    name: { en: 'What to expect after the first adjustment', es: 'Qué esperar tras la primera visita' },
    description: {
      en: 'Explains the normal reactions to a first adjustment, so nobody worries in silence.',
      es: 'Explica las reacciones normales al primer ajuste, para que nadie se preocupe en silencio.',
    },
    triggerEvent: 'appointment.completed',
    isMarketing: false,
    filters: { total_visits: 1 },
    subject: { en: 'What to expect over the next few days', es: 'Qué esperar en los próximos días' },
    body: {
      en: `<p>Hi {{first_name}},</p>
<p>Thank you for trusting us with your first visit. Every body responds differently, so here is what is normal over the next few days:</p>
<p><strong>Clear improvement that lasts.</strong> You feel lighter and move more easily — a sign your body responded well to the adjustment.</p>
<p><strong>Improvement that fades after a few days.</strong> You feel relief immediately, then everything seems to go back to how it was. This is completely normal: one session rarely produces lasting change on its own, which is exactly why we build a care plan.</p>
<p><strong>You feel worse for a few days.</strong> A normal inflammatory reaction can appear. It is not a cause for concern and usually settles within a few days. Applying cold to the area helps.</p>
<p><strong>You notice no change at all.</strong> This is common when the problem is long-standing — the body does not always respond to the first session, and that is normal too.</p>
<p>Any of these is normal, and we are very used to working with all of them. If you have questions or want to tell us how you are feeling, just reply.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>Hola {{first_name}},</p>
<p>Gracias por confiar en nosotros en tu primera visita. Cada cuerpo reacciona de forma diferente, así que queremos que sepas qué es normal sentir en los próximos días:</p>
<p><strong>Mejoría directa y que se mantiene.</strong> Te sientes más ligero/a y te mueves con más facilidad. Es señal de que tu cuerpo ha respondido bien al ajuste.</p>
<p><strong>Mejoría que vuelve a los pocos días.</strong> Notas alivio al momento, pero después sientes que todo vuelve como antes. Es completamente normal: en una sola sesión es difícil generar cambios duraderos, y por eso diseñamos un plan de cuidado.</p>
<p><strong>Te sientes peor los días siguientes.</strong> Puede aparecer una reacción inflamatoria normal. No es motivo de preocupación y suele resolverse en pocos días. Si lo notas, puedes aplicar frío en la zona.</p>
<p><strong>No has notado ningún cambio.</strong> Suele ocurrir cuando la molestia es muy crónica. El cuerpo no siempre reacciona a la primera sesión, y también es normal.</p>
<p>Cualquiera de estas reacciones es normal y estamos muy acostumbrados a trabajar con ellas. Si tienes dudas o quieres contarnos cómo te sientes, responde a este correo.</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'chiropractic-report',
    name: { en: 'Chiropractic report ready', es: 'Informe quiropráctico listo' },
    description: {
      en: 'Tells the patient their report and care plan are ready, and where to read them.',
      es: 'Avisa de que el informe y el plan de cuidado están listos, y dónde consultarlos.',
    },
    triggerEvent: 'appointment.completed',
    isMarketing: false,
    filters: {},
    subject: { en: 'Your chiropractic report is ready', es: 'Tu informe quiropráctico está listo' },
    body: {
      en: `<p>Hello again {{first_name}},</p>
<p>We have finished analysing the tests from your first visit and prepared your detailed chiropractic report, along with a care plan built around you.</p>
<ul>
<li><strong>Your chiropractic report:</strong> the detailed results of the tests we ran, and a clear picture of the current state of your nervous system and spine.</li>
<li><strong>Your personalised care plan:</strong> the adjustments, exercises and lifestyle changes we recommend, based on that assessment.</li>
</ul>
<p>Both are in your patient area, under Documents. If you have not set it up yet, we will send you the details separately.</p>
<p>If anything raises a question once you have read them, reply to this email and we will go through it with you.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>Hola de nuevo, {{first_name}},</p>
<p>Hemos completado el análisis de las pruebas realizadas en tu primera visita y hemos preparado tu informe quiropráctico detallado, junto con un plan de cuidado personalizado para ti.</p>
<ul>
<li><strong>Informe quiropráctico:</strong> los resultados detallados de las pruebas y una visión clara del estado actual de tu sistema nervioso y tu columna vertebral.</li>
<li><strong>Plan de cuidado personalizado:</strong> los ajustes, ejercicios y cambios de hábitos que te recomendamos, según esa evaluación.</li>
</ul>
<p>Los tienes en tu área de paciente, en el apartado de Documentos. Si todavía no la has configurado, te enviamos los datos por separado.</p>
<p>Si te surge cualquier duda al revisarlos, responde a este correo y lo vemos juntos.</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'care-plan-completed',
    name: { en: 'Care plan completed', es: 'Fin de plan de cuidado' },
    description: {
      en: 'Congratulates the patient on finishing their plan and opens the conversation about what comes next.',
      es: 'Felicita al paciente por completar su plan y abre la conversación sobre los siguientes pasos.',
    },
    triggerEvent: 'appointment.completed',
    isMarketing: false,
    filters: {},
    subject: {
      en: 'Congratulations on completing your care plan',
      es: '¡Enhorabuena por completar tu plan de cuidado!',
    },
    body: {
      en: `<p>Hello again {{first_name}},</p>
<p>You have completed your personalised care plan. Congratulations on the effort and commitment you have put into your health.</p>
<p>Along the way we worked on several things together: hydration, an anti-inflammatory diet, movement and exercise, posture, listening to your body, and your circadian rhythm. Keep those habits going — they are what hold the progress in place.</p>
<p>If you would like to see your before-and-after results and an updated postural analysis, reply to this email and we will share them with you.</p>
<p>We are proud of everything you have achieved, and we are here to keep supporting you.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>Hola de nuevo, {{first_name}},</p>
<p>Has completado con éxito tu plan de cuidado personalizado. ¡Enhorabuena por todo tu esfuerzo y tu dedicación hacia tu salud!</p>
<p>A lo largo del plan hemos trabajado juntos varios aspectos clave: hidratación, dieta antiinflamatoria, movimiento y ejercicio, postura correcta, escuchar a tu cuerpo y tu ciclo circadiano. Sigue con esos hábitos: son los que sostienen lo conseguido.</p>
<p>Si quieres ver la comparación de tus resultados y tu análisis postural actualizado, responde a este correo y te lo compartimos.</p>
<p>Estamos muy orgullosos de lo que has logrado y aquí seguimos para apoyarte.</p>
<p>{{clinic_name}}</p>`,
    },
  },
  {
    key: 'birthday-active',
    name: { en: 'Birthday (active patient)', es: 'Cumpleaños (paciente activo)' },
    description: {
      en: 'A birthday note for patients who already have a future appointment booked.',
      es: 'Felicitación de cumpleaños para pacientes que ya tienen una cita futura reservada.',
    },
    triggerEvent: 'patient.birthday',
    isMarketing: true,
    filters: { has_future_appointment: true },
    subject: { en: 'Happy birthday!', es: '¡Feliz cumpleaños!' },
    body: {
      en: `<p>Hello {{first_name}},</p>
<p>It is a special day and we did not want it to pass without saying happy birthday!</p>
<p>You are much more than a patient to us — you are part of the family here. We are always around if you need anything.</p>
<p>Enjoy your day.</p>
<p>Everyone at {{clinic_name}}</p>`,
      es: `<p>¡Hola, {{first_name}}!</p>
<p>Hoy es un día muy especial y no queríamos dejar pasar la oportunidad de desearte un ¡FELIZ CUMPLEAÑOS!</p>
<p>Para nosotros eres mucho más que un paciente: eres parte de nuestra familia. Aquí estamos para lo que necesites.</p>
<p>¡Disfruta tu día al máximo!</p>
<p>Todo el equipo de {{clinic_name}}</p>`,
    },
  },
  {
    key: 'birthday-lapsed',
    name: { en: 'Birthday (lapsed patient)', es: 'Cumpleaños (paciente inactivo)' },
    description: {
      en: 'A birthday note with an offer, for patients with nothing booked. Edit the discount before enabling.',
      es: 'Felicitación con oferta para pacientes sin cita reservada. Revisa el descuento antes de activarla.',
    },
    triggerEvent: 'patient.birthday',
    isMarketing: true,
    filters: { has_future_appointment: false },
    subject: { en: 'Happy birthday — we have something for you', es: '¡Feliz cumpleaños! Tenemos un regalo para ti' },
    body: {
      en: `<p>Hello {{first_name}},</p>
<p>Happy birthday! We hope you are having a great day.</p>
<p>We noticed it has been a while since your last visit and we have missed you. So here is a birthday gift: <strong>10% off your next adjustment</strong>.</p>
<p>To use it, book during your birthday month and mention this email.</p>
<p>Reply here to book, or if you have any questions.</p>
<p>{{clinic_name}}</p>`,
      es: `<p>¡Hola, {{first_name}}!</p>
<p>¡Feliz cumpleaños! Esperamos que estés teniendo un día fantástico.</p>
<p>Nos hemos dado cuenta de que ha pasado un tiempo desde tu última visita, ¡y te hemos echado de menos! Por eso queremos hacerte un regalo: <strong>un 10% de descuento en tu próximo ajuste</strong>.</p>
<p>Para aprovecharlo, reserva tu cita durante el mes de tu cumpleaños y menciona este correo.</p>
<p>Responde a este correo para reservar o si tienes cualquier pregunta.</p>
<p>{{clinic_name}}</p>`,
    },
  },
]
