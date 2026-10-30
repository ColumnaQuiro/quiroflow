<script setup lang="ts">
import { LEGAL_SUBPROCESSORS } from '~/utils/legalSubprocessors'

definePageMeta({ layout: false })

// What clinics ask before they put their patients in QuiroFlow: where the
// data lives, who can see it, and who else touches it. Every line here is
// something the system does today, checked against the code or the provider
// on 29 Oct 2026 -- a clinic quotes this in its own register of processing,
// so a claim the system does not keep would become the clinic's problem too.
// Change the page with the thing it describes, never ahead of it.

const t = useT()
const { preference } = useLang()
const lang = computed(() => preference.value)

useHead({ title: () => t('Security & data protection — QuiroFlow', 'Seguridad y protección de datos — QuiroFlow') })

const sections = computed(() => [
  {
    id: 'where',
    title: t('Where your data is', 'Dónde están tus datos'),
    points: [
      t(
        'The database and every file (clinical notes, documents, photos, invoices) are stored in the European Union, in Ireland, on Amazon Web Services infrastructure run by Supabase.',
        'La base de datos y todos los archivos (notas clínicas, documentos, fotos, facturas) se guardan en la Unión Europea, en Irlanda, sobre la infraestructura de Amazon Web Services que gestiona Supabase.',
      ),
      t(
        'The application servers that read and write that data run in the same region, Ireland.',
        'Los servidores de la aplicación, que leen y escriben esos datos, funcionan en la misma región: Irlanda.',
      ),
      t(
        'Supabase holds SOC 2 Type 2 and ISO 27001 certifications for the platform our database runs on.',
        'Supabase tiene las certificaciones SOC 2 Tipo 2 e ISO 27001 para la plataforma en la que funciona nuestra base de datos.',
      ),
      t(
        'Some features the clinic chooses to use (email, WhatsApp, the AI receptionist) send the message itself through providers outside the EU. They are all listed below, with the legal safeguard each one uses.',
        'Algunas funciones que la clínica decide usar (email, WhatsApp, la recepcionista IA) envían el propio mensaje a través de proveedores de fuera de la UE. Todos aparecen más abajo, con la garantía legal que usa cada uno.',
      ),
    ],
  },
  {
    id: 'encryption',
    title: t('Encryption', 'Cifrado'),
    points: [
      t(
        'In transit: every connection, from the browser, the mobile app and between our servers, uses HTTPS (TLS).',
        'En tránsito: todas las conexiones, desde el navegador, la app móvil y entre nuestros servidores, usan HTTPS (TLS).',
      ),
      t(
        'At rest: the database, the files and the backups are encrypted with AES-256.',
        'En reposo: la base de datos, los archivos y las copias de seguridad están cifrados con AES-256.',
      ),
      t(
        'Clinical documents, posture photos, invoices and WhatsApp attachments are kept in private storage. They open only through temporary links that expire within minutes to an hour.',
        'Los documentos clínicos, las fotos posturales, las facturas y los adjuntos de WhatsApp están en almacenamiento privado. Solo se abren con enlaces temporales que caducan en minutos o, como mucho, en una hora.',
      ),
      t(
        'Digital certificates uploaded for VeriFactu are encrypted again by QuiroFlow (AES-256-GCM), with a key kept apart from the database.',
        'Los certificados digitales que se suben para VeriFactu se cifran además en QuiroFlow (AES-256-GCM), con una clave guardada fuera de la base de datos.',
      ),
      t(
        'A document sent to a patient by email can be protected with a password (AES-256 PDF).',
        'Un documento enviado a un paciente por email puede ir protegido con contraseña (PDF AES-256).',
      ),
    ],
  },
  {
    id: 'access',
    title: t('Who can see what', 'Quién puede ver qué'),
    points: [
      t(
        'Each clinic is isolated in the database itself (row-level security). The rules live in the database, not only on screen, so one clinic\'s staff cannot reach another clinic\'s data even by calling the API directly.',
        'Cada clínica está aislada en la propia base de datos (seguridad a nivel de fila). Las reglas están en la base de datos, no solo en la pantalla: el personal de una clínica no puede llegar a los datos de otra ni llamando directamente a la API.',
      ),
      t(
        'Inside a clinic, roles and permissions decide what each team member sees and does: for example, a role can work the diary without seeing amounts owed.',
        'Dentro de cada clínica, los roles y permisos deciden qué ve y qué hace cada persona del equipo: por ejemplo, un rol puede llevar la agenda sin ver lo que se debe.',
      ),
      t(
        'Clinic settings such as fees or message templates can only be changed by someone with that page\'s permission, and the database checks it on every change.',
        'Los ajustes de la clínica, como las tarifas o las plantillas de mensajes, solo los cambia quien tiene el permiso de ese apartado, y la base de datos lo comprueba en cada cambio.',
      ),
      t(
        'Patients using the app or the portal see only their own appointments, documents and bonos.',
        'Los pacientes que usan la app o el portal solo ven sus propias citas, documentos y bonos.',
      ),
    ],
  },
  {
    id: 'sign-in',
    title: t('Signing in', 'Inicio de sesión'),
    points: [
      t(
        'Two-factor login with an authenticator app is available to every team member, and a clinic\'s owner can make it compulsory for the whole team.',
        'El inicio de sesión en dos pasos con una app de autenticación está disponible para cada persona del equipo, y el propietario de la clínica puede hacerlo obligatorio para todos.',
      ),
      t(
        'It is enforced by the database: when two-factor applies, a password alone, even a stolen one, reads nothing.',
        'Lo aplica la base de datos: cuando el doble factor es obligatorio, una contraseña sola, aunque sea robada, no permite leer nada.',
      ),
      t(
        'Passwords are never stored, only a one-way hash of them (bcrypt).',
        'Las contraseñas nunca se guardan: solo una huella irreversible de ellas (bcrypt).',
      ),
    ],
  },
  {
    id: 'activity',
    title: t('Activity log', 'Registro de actividad'),
    points: [
      t(
        'Every change to patient records, clinical notes, billing, team permissions and settings is recorded with the values before and after, and who made it.',
        'Cada cambio en fichas de pacientes, notas clínicas, facturación, permisos del equipo y ajustes queda registrado con los valores de antes y después, y con quién lo hizo.',
      ),
      t(
        'So is every opening of a patient\'s record or files, every export, every sign-in and every change of password or two-factor.',
        'También cada vez que alguien abre la ficha o los archivos de un paciente, cada exportación, cada inicio de sesión y cada cambio de contraseña o de doble factor.',
      ),
      t(
        'The log cannot be edited or deleted. The clinic\'s owners read it in Settings › Activity log, which lets the clinic answer exactly who accessed a patient\'s record.',
        'El registro no se puede editar ni borrar. Los propietarios de la clínica lo consultan en Ajustes › Registro de actividad, y así la clínica puede responder exactamente quién accedió a la historia de un paciente.',
      ),
    ],
  },
  {
    id: 'backups',
    title: t('Backups and availability', 'Copias de seguridad y disponibilidad'),
    points: [
      t(
        'The database is backed up automatically every day, and the last 7 days of backups are kept.',
        'La base de datos se copia automáticamente cada día, y se conservan las copias de los últimos 7 días.',
      ),
      t(
        'Files are kept in Amazon Web Services object storage, which stores each one redundantly across several data centres in the region.',
        'Los archivos se guardan en el almacenamiento de objetos de Amazon Web Services, que guarda cada uno de forma redundante en varios centros de datos de la región.',
      ),
      t(
        'Errors are reported to us automatically as they happen, without any patient data in them.',
        'Los errores nos llegan automáticamente en cuanto ocurren, sin ningún dato de pacientes.',
      ),
    ],
  },
  {
    id: 'retention',
    title: t('Retention and patients\' rights', 'Conservación y derechos de los pacientes'),
    points: [
      t(
        'The clinic decides how long clinical records are kept (at least 5 years, as Ley 41/2002 requires) in Settings › Privacy. Nothing is deleted by itself: a record past its period is anonymised only when an owner decides to.',
        'La clínica decide cuánto tiempo se conservan las historias clínicas (como mínimo 5 años, como exige la Ley 41/2002) en Ajustes › Privacidad. Nada se borra solo: una historia fuera de plazo solo se anonimiza cuando un propietario lo decide.',
      ),
      t(
        'Invoices sent to VeriFactu are kept even if the patient is deleted, because tax law requires it.',
        'Las facturas enviadas a VeriFactu se conservan aunque se borre al paciente, porque lo exige la normativa fiscal.',
      ),
      t(
        'The clinic can export its patients at any time, and answer access, rectification and erasure requests from the patient\'s record.',
        'La clínica puede exportar sus pacientes cuando quiera, y atender las solicitudes de acceso, rectificación y supresión desde la ficha del paciente.',
      ),
    ],
  },
  {
    id: 'our-team',
    title: t('QuiroFlow\'s own access', 'El acceso del equipo de QuiroFlow'),
    points: [
      t(
        'The clinic is the data controller and QuiroFlow is its data processor (Art. 28 GDPR): we process patients\' data only to provide the service, on the clinic\'s instructions, and never for our own purposes.',
        'La clínica es la responsable del tratamiento y QuiroFlow es su encargado (art. 28 RGPD): tratamos los datos de los pacientes solo para prestar el servicio, siguiendo las instrucciones de la clínica, y nunca para fines propios.',
      ),
      t(
        'Our internal control panel shows billing and counts (how many patients or appointments), never a patient\'s record.',
        'Nuestro panel interno muestra la facturación y cifras (cuántos pacientes o citas), nunca la ficha de un paciente.',
      ),
      t(
        'Technical access to the database is limited to the people who run the service, and is used to keep it working or to solve a problem the clinic has asked us about.',
        'El acceso técnico a la base de datos está limitado a las personas que mantienen el servicio, y se usa para que funcione o para resolver una incidencia que la clínica nos haya planteado.',
      ),
    ],
  },
])
</script>

<template>
  <div class="min-h-screen bg-surface-page">
    <div class="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <div class="flex items-center justify-between gap-4">
        <NuxtLink to="/" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">&larr; QuiroFlow</NuxtLink>
        <AuthLangToggle />
      </div>

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">{{ t('Security & data protection', 'Seguridad y protección de datos') }}</h1>
      <p class="mt-1 text-[13px] text-ink-faint">{{ t('Last updated: 29 October 2026', 'Última actualización: 29 de octubre de 2026') }}</p>

      <p class="mt-6 text-[14px] leading-relaxed text-ink-700">
        {{
          t(
            'QuiroFlow holds clinical records, so we treat security as part of the product rather than an add-on. This page describes what the system does today, so your clinic can rely on it and quote it in its own records of processing.',
            'QuiroFlow guarda historias clínicas, así que la seguridad es parte del producto y no un añadido. Esta página describe lo que el sistema hace hoy, para que tu clínica pueda confiar en ello y citarlo en su propio registro de actividades de tratamiento.',
          )
        }}
      </p>

      <nav class="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" :aria-label="t('On this page', 'En esta página')">
        <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="text-brand-text hover:text-brand-hover">{{ s.title }}</a>
        <a href="#providers" class="text-brand-text hover:text-brand-hover">{{ t('Providers', 'Proveedores') }}</a>
      </nav>

      <section class="mt-8 space-y-8 text-[13.5px] leading-relaxed text-ink-700">
        <div v-for="s in sections" :id="s.id" :key="s.id" class="scroll-mt-6" data-cy="security-section">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ s.title }}</h2>
          <ul class="mt-2 list-disc space-y-1.5 pl-5">
            <li v-for="(p, i) in s.points" :key="i">{{ p }}</li>
          </ul>
        </div>

        <div id="providers" class="scroll-mt-6">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Providers that process data (subprocessors)', 'Proveedores que tratan datos (subencargados)') }}</h2>
          <p class="mt-2">
            {{
              t(
                'Each one works under a data processing agreement. Where data leaves the EU, the transfer is covered by the safeguard shown.',
                'Cada uno trabaja con un contrato de tratamiento de datos. Cuando los datos salen de la UE, la transferencia está cubierta por la garantía indicada.',
              )
            }}
          </p>
          <ul class="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface" data-cy="subprocessors">
            <li v-for="p in LEGAL_SUBPROCESSORS" :key="p.name" class="px-4 py-3">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span class="font-semibold text-ink-900">{{ p.name }}</span>
                <span class="text-[12.5px] text-ink-muted">{{ p.location[lang] }}</span>
              </div>
              <p class="mt-0.5">{{ p.purpose[lang] }}</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ p.basis[lang] }}<template v-if="p.note"> · {{ p.note[lang] }}</template></p>
            </li>
          </ul>
        </div>

        <div id="verifactu" class="scroll-mt-6">
          <h2 class="text-[15px] font-semibold text-ink-900">VeriFactu</h2>
          <p class="mt-2">
            {{
              t(
                'Every invoice produces a chained, tamper-evident billing record that the database refuses to modify or delete. What QuiroFlow declares as the producer of the system is published in its',
                'Cada factura genera un registro de facturación encadenado e inalterable, que la base de datos se niega a modificar o borrar. Lo que QuiroFlow declara como productor del sistema está publicado en su',
              )
            }}
            <NuxtLink to="/legal/declaracion-responsable" class="text-brand-text hover:text-brand-hover">{{ t('responsible declaration', 'declaración responsable') }}</NuxtLink>.
          </p>
        </div>

        <div id="contact" class="scroll-mt-6">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Questions and reporting a vulnerability', 'Preguntas y aviso de vulnerabilidades') }}</h2>
          <p class="mt-2">
            {{
              t(
                'Write to us at hola@quiroflow.com, for questions about this page, for the data processing agreement, or if you believe you have found a security problem. We answer security reports first.',
                'Escríbenos a hola@quiroflow.com si tienes preguntas sobre esta página, si necesitas el contrato de encargado del tratamiento o si crees haber encontrado un problema de seguridad. Los avisos de seguridad los atendemos primero.',
              )
            }}
          </p>
          <p class="mt-2 text-ink-muted">Columnaquiro S.L. · B16365504 · Calle Vivons 29, Bajo Izquierdo, 46006 Valencia</p>
          <p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <NuxtLink to="/legal/privacy" class="text-brand-text hover:text-brand-hover">{{ t('Privacy policy', 'Política de privacidad') }}</NuxtLink>
            <NuxtLink to="/legal/terms" class="text-brand-text hover:text-brand-hover">{{ t('Terms of service', 'Condiciones del servicio') }}</NuxtLink>
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
