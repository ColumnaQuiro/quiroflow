// The twelve articles a clinic's education library can start with
// (Ajustes › Educación, "Añadir las de QuiroFlow"). Copied into the clinic's
// own learn_articles, keyed by `key` so they are only ever added once, and
// from then on the clinic's to edit or archive.
//
// Written as general patient education: what helps, what to expect, and when
// to see a doctor -- never a diagnosis or a promise. Plain text; a blank line
// separates paragraphs.

export interface StarterArticle {
  key: string
  title: string
  summary: string
  body: string
  tags: string[]
  minutes: number
}

export const LEARN_STARTER: StarterArticle[] = [
  {
    key: 'ajuste-que-es',
    title: 'Qué es un ajuste quiropráctico',
    summary: 'Qué hacemos en la camilla, por qué a veces suena y qué vas a notar.',
    tags: ['primera_visita'],
    minutes: 3,
    body: `Un ajuste es un movimiento preciso y controlado que el quiropráctico aplica a una articulación que no se mueve como debería, sobre todo en la columna. El objetivo es devolverle movilidad y que los músculos y nervios de alrededor trabajen con menos tensión.

A veces se oye un chasquido. Es gas que se libera dentro de la articulación al separarse un poco sus superficies, igual que al estirar los dedos. No es un hueso que «se coloca» y no indica que el ajuste haya ido mejor o peor.

Antes de ajustar te exploramos y te preguntamos por tu salud. Si algo no es para nosotros, te lo diremos y te orientaremos a quien corresponda.

Lo habitual es notar más soltura. Algunas personas sienten algo de rigidez o cansancio durante uno o dos días, como después de hacer ejercicio. Si algo te preocupa, escríbenos.`,
  },
  {
    key: 'despues-primer-ajuste',
    title: 'Después de tu primer ajuste',
    summary: 'Qué es normal sentir los primeros días y qué te ayuda.',
    tags: ['primera_visita'],
    minutes: 2,
    body: `Es normal notar algo de rigidez, sensibilidad o cansancio durante 24 a 48 horas. Suele ser leve y se pasa sola.

Lo que más ayuda: moverte con normalidad, caminar, beber agua y evitar pasar muchas horas en la misma postura. Si te molesta, el calor suave o el frío local unos minutos pueden aliviar.

No hace falta guardar reposo ni dejar tu actividad, salvo que te indiquemos otra cosa. Haz los ejercicios de tu plan si te los hemos dado.

Avísanos si el dolor aumenta claramente, si aparece hormigueo o debilidad nueva en brazos o piernas, o si te encuentras mal. Y cuéntanoslo en la próxima visita: nos ayuda a ajustar el plan.`,
  },
  {
    key: 'hernia-discal',
    title: 'Hernia discal: qué pasa y qué ayuda',
    summary: 'Por qué duele, por qué a veces baja a la pierna y por qué la mayoría mejora sin cirugía.',
    tags: ['lumbar'],
    minutes: 4,
    body: `El disco es un cojín entre dos vértebras. Tiene un anillo exterior fibroso y un centro más blando. En una hernia, parte del centro empuja hacia fuera y puede irritar un nervio cercano. Por eso el dolor a veces baja por la pierna.

Tener una hernia en una resonancia no siempre significa tener dolor: muchas personas sin molestias también las tienen. Lo importante es cómo estás y cómo evolucionas.

La mayoría de las hernias mejoran con el tiempo sin cirugía. Lo que más ayuda es mantenerse activo dentro de lo tolerable, caminar, evitar estar sentado mucho rato seguido y hacer los ejercicios de tu plan. El reposo en cama prolongado no ayuda.

Consulta con un médico sin esperar si notas pérdida de fuerza en una pierna, adormecimiento en la zona genital o entre las piernas, o problemas para orinar o controlar el intestino.`,
  },
  {
    key: 'lumbar-moverse',
    title: 'Dolor lumbar: moverse ayuda',
    summary: 'Por qué el reposo no es la solución y cómo volver poco a poco a tu día a día.',
    tags: ['lumbar'],
    minutes: 3,
    body: `El dolor lumbar es muy frecuente y en la gran mayoría de los casos no se debe a nada grave. Aunque duela, la espalda es fuerte.

Moverse es parte del tratamiento. Caminar a diario, aunque sean paseos cortos, y seguir con tus actividades adaptándolas ayuda más que quedarse en la cama.

Cambia de postura a menudo. Ninguna postura es perfecta si la mantienes horas: la mejor postura es la siguiente.

El miedo a moverse puede alargar el dolor. Si una actividad te molesta, haz menos, más despacio o con pausas, pero no la abandones del todo. Te ayudaremos a ir volviendo a lo que te gusta hacer.`,
  },
  {
    key: 'dormir-espalda',
    title: 'Dormir mejor con dolor de espalda',
    summary: 'Posturas y pequeños cambios que alivian la noche.',
    tags: ['lumbar', 'general'],
    minutes: 2,
    body: `De lado: una almohada entre las rodillas mantiene la pelvis alineada y descarga la zona lumbar.

Boca arriba: una almohada bajo las rodillas suele aliviar. La de la cabeza, ni muy alta ni muy baja, que el cuello quede en línea con la espalda.

Boca abajo suele cargar el cuello y la zona lumbar. Si es tu postura de siempre, prueba una almohada fina bajo la pelvis.

Para levantarte, gírate de lado, baja las piernas de la cama y empújate con los brazos. Un colchón firme pero no duro suele ir mejor que uno muy blando.`,
  },
  {
    key: 'cuello-pantallas',
    title: 'El cuello y las pantallas',
    summary: 'Por qué el móvil carga el cuello y cómo usarlo sin que duela.',
    tags: ['cervical', 'trabajo'],
    minutes: 2,
    body: `Cuanto más adelantas e inclinas la cabeza, más trabajan los músculos del cuello y de la parte alta de la espalda para sostenerla.

Sube el móvil a la altura de los ojos en lugar de bajar la cabeza hacia él. Apoya los codos si vas a leer un rato.

Haz pausas: cada 20 o 30 minutos, mira lejos, lleva la barbilla suavemente hacia atrás (como haciendo papada) y mueve los hombros.

Con el ordenador, la parte de arriba de la pantalla debería quedar a la altura de los ojos y a un brazo de distancia.`,
  },
  {
    key: 'cefalea-cervical',
    title: 'Dolor de cabeza que nace en el cuello',
    summary: 'Cuándo el cuello puede estar detrás de tu dolor de cabeza y qué ayuda.',
    tags: ['cefalea', 'cervical'],
    minutes: 3,
    body: `Algunos dolores de cabeza empiezan en la nuca y suben hacia la cabeza, a menudo de un lado. Pueden empeorar con ciertas posturas o movimientos del cuello. Es lo que se llama cefalea cervicogénica.

Ayuda cuidar la postura frente a pantallas, hacer pausas, dormir con una almohada que deje el cuello alineado y los ejercicios de movilidad y fuerza que te indiquemos.

Lleva un registro: cuándo aparece, cuánto dura y qué estabas haciendo. Nos ayuda a ver si mejora.

Consulta con un médico sin esperar si es el peor dolor de cabeza de tu vida, si aparece de golpe, con fiebre y rigidez de cuello, tras un golpe en la cabeza, o con visión doble, dificultad para hablar o debilidad.`,
  },
  {
    key: 'puesto-trabajo',
    title: 'Tu puesto de trabajo en 5 pasos',
    summary: 'Silla, pantalla, teclado y pausas: lo esencial para trabajar sentado.',
    tags: ['trabajo', 'cervical', 'lumbar'],
    minutes: 3,
    body: `1. Silla: pies apoyados en el suelo, rodillas a la altura de la cadera o un poco más bajas, y la espalda apoyada en el respaldo.

2. Pantalla: el borde superior a la altura de los ojos, a un brazo de distancia. Con portátil, súbelo y usa teclado y ratón aparte.

3. Teclado y ratón: cerca del cuerpo, con los codos a unos 90 grados y los hombros relajados.

4. Luz: evita reflejos en la pantalla y no trabajes con una ventana justo detrás.

5. Pausas: levántate cada 30 a 45 minutos, aunque sea un minuto. Moverse a menudo importa más que la postura perfecta.`,
  },
  {
    key: 'levantar-peso',
    title: 'Levantar peso sin cargar la espalda',
    summary: 'Cómo coger cajas, la compra o a tus hijos con menos esfuerzo.',
    tags: ['lumbar', 'trabajo'],
    minutes: 2,
    body: `Acércate al objeto: cuanto más lejos del cuerpo, más pesa para tu espalda.

Separa los pies, dobla caderas y rodillas, y sube empujando con las piernas. Mantén la carga pegada al cuerpo.

Evita girar el tronco con peso en las manos: gira con los pies.

Si es muy pesado o incómodo, pide ayuda o divídelo. Y no pasa nada por doblar la espalda en tareas ligeras: una espalda fuerte y en movimiento se adapta bien.`,
  },
  {
    key: 'embarazo-espalda',
    title: 'Espalda y embarazo',
    summary: 'Por qué cambia la espalda durante el embarazo y qué te puede aliviar.',
    tags: ['embarazo', 'lumbar'],
    minutes: 3,
    body: `Durante el embarazo cambia el centro de gravedad, aumenta la curva lumbar y las hormonas hacen más flexibles los ligamentos de la pelvis. Por eso es frecuente notar molestias en la zona lumbar o en la pelvis.

Ayuda mantenerse activa con ejercicio suave, como caminar, nadar o los ejercicios que te indiquemos; dormir de lado con una almohada entre las rodillas; y llevar calzado cómodo y estable.

Al levantarte de la cama, gírate de lado y empújate con los brazos. Evita levantar pesos grandes.

Ante sangrado, contracciones, dolor intenso que no cede, fiebre o cualquier duda sobre el embarazo, consulta con tu matrona o tu médico.`,
  },
  {
    key: 'ciatica-alarma',
    title: 'Ciática: cuándo consultar sin esperar',
    summary: 'Las señales que no deben esperar a tu próxima visita.',
    tags: ['lumbar'],
    minutes: 2,
    body: `La ciática es dolor que baja por la pierna por irritación de un nervio de la zona lumbar. La mayoría mejora con el tiempo y con un plan de tratamiento.

Hay señales poco frecuentes pero importantes. Acude a urgencias si notas:

Adormecimiento en la zona genital, entre las piernas o en las nalgas.

Dificultad nueva para orinar, o pérdida de control de la orina o las heces.

Pérdida de fuerza que va a más en una pierna o en las dos, por ejemplo que el pie se te cae al andar.

Dolor con fiebre, o tras una caída o un golpe fuerte. Ante cualquier duda, llámanos.`,
  },
  {
    key: 'frio-o-calor',
    title: '¿Frío o calor?',
    summary: 'Cuándo usar cada uno y cómo aplicarlos sin riesgo.',
    tags: ['general'],
    minutes: 2,
    body: `Frío: suele ir mejor en las primeras 48 horas tras un golpe o un esfuerzo, o si la zona está caliente o inflamada. Aplícalo 10 a 15 minutos, siempre con un paño entre el hielo y la piel.

Calor: suele aliviar la rigidez y la tensión muscular, sobre todo en molestias que duran días. Una bolsa de agua caliente o una ducha caliente, unos 15 a 20 minutos.

Si los dos te alivian, usa el que te siente mejor.

No los apliques si tienes la sensibilidad de la piel alterada, y no te duermas con una fuente de calor puesta.`,
  },
]
