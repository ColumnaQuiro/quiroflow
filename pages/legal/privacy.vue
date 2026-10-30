<script setup lang="ts">
import { LEGAL_SUBPROCESSORS } from '~/utils/legalSubprocessors'

definePageMeta({ layout: false })

// The subprocessors come from utils/legalSubprocessors.ts, the same list
// /legal/security shows, so the two pages cannot drift apart. The facts
// behind it (regions, transfer safeguards) are recorded there.
const t = useT()
const { preference } = useLang()
const lang = computed(() => preference.value)

useHead({ title: () => t('Privacy policy — QuiroFlow', 'Política de privacidad — QuiroFlow') })
</script>

<template>
  <div class="min-h-screen bg-surface-page">
    <div class="mx-auto max-w-[720px] px-4 py-12 sm:px-6 sm:py-16">
      <div class="flex items-center justify-between gap-4">
        <NuxtLink to="/" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">&larr; QuiroFlow</NuxtLink>
        <AuthLangToggle />
      </div>

      <div class="mt-6 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-text">
        <strong>{{ t('Pending legal review.', 'Pendiente de revisión legal.') }}</strong>
        {{ t('This policy has not yet been reviewed by a lawyer.', 'Esta política todavía no la ha revisado un abogado.') }}
      </div>

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">{{ t('Privacy policy', 'Política de privacidad') }}</h1>
      <p class="mt-1 text-[13px] text-ink-faint">{{ t('Last updated: 29 October 2026', 'Última actualización: 29 de octubre de 2026') }}</p>

      <div class="mt-8 rounded-card border border-line bg-surface p-5 text-[13.5px] leading-relaxed text-ink-700">
        <p class="font-medium text-ink-900">{{ t('Who this policy covers, and who it doesn\'t', 'A quién se aplica esta política, y a quién no') }}</p>
        <p class="mt-2">
          {{
            t(
              'QuiroFlow ("we", "us") is the software clinics use to run their practice. For a clinic\'s own patient data (appointments, clinical notes, billing, messages) the clinic is the data controller and QuiroFlow is its data processor under Art. 28 GDPR, acting only on the clinic\'s instructions. This policy describes what QuiroFlow itself does as a company: the account and staff data we hold directly, and our role as a processor. It does not replace the privacy notice each clinic gives its own patients; each clinic is responsible for that.',
              'QuiroFlow ("nosotros") es el programa que usan las clínicas para gestionar su consulta. De los datos de pacientes de cada clínica (citas, notas clínicas, facturación, mensajes) la clínica es la responsable del tratamiento y QuiroFlow es su encargado según el art. 28 del RGPD, y solo actúa siguiendo sus instrucciones. Esta política describe lo que hace QuiroFlow como empresa: los datos de cuentas y del personal que tratamos directamente, y nuestro papel como encargado. No sustituye a la información de privacidad que cada clínica da a sus propios pacientes; eso es responsabilidad de cada clínica.',
            )
          }}
        </p>
      </div>

      <section class="mt-8 space-y-6 text-[13.5px] leading-relaxed text-ink-700">
        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('1. Who we are', '1. Quiénes somos') }}</h2>
          <p class="mt-2">Columnaquiro S.L., NIF B16365504, Calle Vivons 29, Bajo Izquierdo, 46006 Valencia, {{ t('Spain', 'España') }}. {{ t('Contact', 'Contacto') }}: hola@quiroflow.com.</p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('2. What data we process, and why', '2. Qué datos tratamos y para qué') }}</h2>
          <ul class="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              <strong>{{ t('Clinic staff accounts', 'Cuentas del personal de la clínica') }}</strong>
              {{ t('(name, email, role): to provide the service and manage access, under our contract with the clinic (GDPR Art. 6(1)(b)).', '(nombre, email, rol): para prestar el servicio y gestionar los accesos, en virtud de nuestro contrato con la clínica (art. 6.1.b RGPD).') }}
            </li>
            <li>
              <strong>{{ t('Patient data entered by clinics', 'Datos de pacientes que introducen las clínicas') }}</strong>
              {{ t('(appointments, clinical notes, billing, messages, uploaded files): processed strictly on each clinic\'s instructions, as its processor. We do not decide why this data is collected or how it is used.', '(citas, notas clínicas, facturación, mensajes, archivos): tratados estrictamente según las instrucciones de cada clínica, como su encargado. No decidimos para qué se recogen ni cómo se usan.') }}
            </li>
            <li>
              <strong>{{ t('Device and usage data', 'Datos del dispositivo y de uso') }}</strong>
              {{ t('(app opens, push-notification tokens): to operate and improve the mobile app.', '(aperturas de la app, identificadores de notificaciones): para hacer funcionar y mejorar la app móvil.') }}
            </li>
            <li>
              <strong>{{ t('Security and audit logs', 'Registros de seguridad y auditoría') }}</strong>
              {{ t('(staff sign-ins with IP address and device; who opened or changed which record, and when): to protect the clinic\'s data and let the clinic answer who accessed a patient\'s record (GDPR Art. 32; legitimate interest, Art. 6(1)(f)). Visible only to the clinic\'s owners.', '(inicios de sesión del personal con dirección IP y dispositivo; quién abrió o cambió cada ficha y cuándo): para proteger los datos de la clínica y que pueda responder quién accedió a la historia de un paciente (art. 32 RGPD; interés legítimo, art. 6.1.f). Solo los ven los propietarios de la clínica.') }}
            </li>
            <li>
              <strong>{{ t('Error reports', 'Informes de errores') }}</strong>
              {{ t('(the page and code location where the app failed, the browser, and the clinic and staff account IDs): to find and fix faults. Request bodies, search terms, cookies and IP addresses are removed before sending; no patient data is included.', '(la página y el punto del código donde falló la app, el navegador y los identificadores de la clínica y del usuario): para encontrar y corregir fallos. Antes de enviarlos se quitan los cuerpos de petición, las búsquedas, las cookies y las direcciones IP; no incluyen datos de pacientes.') }}
            </li>
            <li>
              <strong>{{ t('Support communications:', 'Comunicaciones de soporte:') }}</strong>
              {{ t('to answer clinics that contact us.', 'para responder a las clínicas que nos escriben.') }}
            </li>
          </ul>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('3. Where data is hosted', '3. Dónde se alojan los datos') }}</h2>
          <p class="mt-2">
            {{
              t(
                'The database and all files are hosted in the EU (Ireland), and the application servers run in the same region. Static parts of the web app (code, images) are delivered through Netlify\'s global network. How the data is protected is described in',
                'La base de datos y todos los archivos se alojan en la UE (Irlanda), y los servidores de la aplicación funcionan en la misma región. Las partes estáticas de la web (código, imágenes) se entregan a través de la red global de Netlify. Cómo se protegen los datos se explica en',
              )
            }}
            <NuxtLink to="/legal/security" class="text-brand-text hover:text-brand-hover">{{ t('Security & data protection', 'Seguridad y protección de datos') }}</NuxtLink>.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('4. Subprocessors', '4. Subencargados') }}</h2>
          <p class="mt-2">
            {{
              t(
                'We use the following subprocessors. Each has its own data processing terms; where data leaves the EU/EEA, the safeguard is shown.',
                'Usamos los siguientes subencargados. Cada uno tiene sus propias condiciones de tratamiento de datos; cuando los datos salen de la UE/EEE, se indica la garantía que se aplica.',
              )
            }}
          </p>
          <ul class="mt-2 list-disc space-y-1.5 pl-5" data-cy="subprocessors">
            <li v-for="p in LEGAL_SUBPROCESSORS" :key="p.name">
              <strong>{{ p.name }}</strong> ({{ p.purpose[lang] }}) — {{ p.location[lang] }}; {{ p.basis[lang] }}.<template v-if="p.note"> {{ p.note[lang] }}.</template>
            </li>
          </ul>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('5. How long we keep data', '5. Cuánto tiempo conservamos los datos') }}</h2>
          <p class="mt-2">
            {{
              t(
                'Staff account data is kept while the clinic\'s account is active. When the contract ends, we delete or return the clinic\'s data as the clinic instructs, except what the law requires to be kept (such as VeriFactu billing records). Patient data retention is set by each clinic in Settings › Privacy, in line with health-records law (Spain\'s Ley 41/2002 sets a minimum of 5 years for clinical records, longer in some regions); nothing is deleted without an owner deciding to.',
                'Los datos de las cuentas del personal se conservan mientras la cuenta de la clínica esté activa. Al terminar el contrato, borramos o devolvemos los datos de la clínica según nos indique, salvo lo que la ley obliga a conservar (como los registros de facturación VeriFactu). El plazo de conservación de los datos de pacientes lo fija cada clínica en Ajustes › Privacidad, conforme a la normativa sanitaria (la Ley 41/2002 exige al menos 5 años para la historia clínica, más en algunas comunidades); nada se borra sin que lo decida un propietario.',
              )
            }}
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('6. Your rights', '6. Tus derechos') }}</h2>
          <p class="mt-2">
            {{
              t(
                'If you are a clinic staff member, write to hola@quiroflow.com to access, correct or delete your account data. If you are a patient, please contact your clinic: it is the controller of your health data and handles your request, and we assist it as its processor.',
                'Si eres parte del personal de una clínica, escribe a hola@quiroflow.com para acceder a tus datos de cuenta, corregirlos o borrarlos. Si eres paciente, dirígete a tu clínica: es la responsable de tus datos de salud y atiende tu solicitud, y nosotros la ayudamos como su encargado.',
              )
            }}
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('7. Security', '7. Seguridad') }}</h2>
          <p class="mt-2">
            {{
              t(
                'Data is encrypted in transit (HTTPS) and at rest (AES-256). Each clinic\'s data is isolated by row-level security in the database, two-factor login can be made compulsory per clinic, and every change and every opening of a patient\'s record is kept in an audit log that cannot be edited or deleted. The full description is in',
                'Los datos van cifrados en tránsito (HTTPS) y en reposo (AES-256). Los datos de cada clínica están aislados por seguridad a nivel de fila en la base de datos, el doble factor se puede hacer obligatorio por clínica, y cada cambio y cada apertura de la ficha de un paciente quedan en un registro de auditoría que no se puede editar ni borrar. La descripción completa está en',
              )
            }}
            <NuxtLink to="/legal/security" class="text-brand-text hover:text-brand-hover">{{ t('Security & data protection', 'Seguridad y protección de datos') }}</NuxtLink>.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('8. Supervisory authority', '8. Autoridad de control') }}</h2>
          <p class="mt-2">
            {{ t('You can lodge a complaint with your local data protection authority: in Spain, the', 'Puedes presentar una reclamación ante la autoridad de protección de datos: en España, la') }}
            <a href="https://www.aepd.es" target="_blank" rel="noopener" class="text-brand-text hover:text-brand-hover">Agencia Española de Protección de Datos (AEPD)</a>.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('9. Changes to this policy', '9. Cambios en esta política') }}</h2>
          <p class="mt-2">
            {{
              t(
                'We update the date at the top of this page when this policy changes and, for material changes, notify clinics directly.',
                'Cuando cambie esta política actualizaremos la fecha de arriba y, si el cambio es importante, avisaremos directamente a las clínicas.',
              )
            }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
