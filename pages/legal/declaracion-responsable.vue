<script setup lang="ts">
import {
  SIF_CODE,
  SIF_COMPONENTS,
  SIF_DECLARATION_IN_FORCE,
  SIF_DECLARATION_SIGNED,
  SIF_FUNCTIONS,
  SIF_HUELLA_SPEC,
  SIF_NAME,
  SIF_ONLY_VERIFACTU,
  SIF_PRODUCER,
  SIF_SUPPORTS_MULTIPLE_OBLIGADOS,
  SIF_SYSTEM_NAME,
  SIF_VERSION,
} from '~/utils/sifIdentity'

definePageMeta({ layout: false })

useHead({ title: `Declaración responsable — ${SIF_NAME} ${SIF_VERSION}` })

// RD 1007/2023 art. 13 requires the producer to declare that the system
// meets the requirements, and Orden HAC/1177/2024 art. 15 fixes what the
// declaration says and in what order: the title, then letters a) to l), each
// preceded by a description of what it is. That part is the declaration;
// everything after it is the "información adicional" art. 15.2 recommends.
//
// Each requirement is listed with what actually implements it, because a
// declaration that only says "cumple" tells an inspector nothing and tells a
// clinic less. One that is not met says so: a declaración responsable is a
// statement with legal effect, and claiming something that does not happen
// would be a false one.
const requirements = [
  {
    name: 'Integridad e inalterabilidad',
    done: true,
    detail:
      'Cada factura genera un registro de facturación de alta. La tabla es de sólo anexado: cualquier UPDATE o DELETE es rechazado por la propia base de datos, incluso con la clave de servicio que usa la aplicación.',
  },
  {
    name: 'Trazabilidad (encadenamiento)',
    done: true,
    detail:
      `Cada registro incorpora la huella del anterior, formando una cadena. La huella es SHA-256 sobre el formato publicado por la AEAT (versión ${SIF_HUELLA_SPEC}) y coincide con el ejemplo de la especificación oficial.`,
  },
  {
    name: 'Verificabilidad',
    done: true,
    detail:
      'El sistema recalcula cada huella a partir del contenido del propio registro y comprueba cada enlace, señalando por separado un registro alterado, un registro ausente y una cadena pendiente de reconstrucción.',
  },
  {
    name: 'Conservación, accesibilidad y legibilidad',
    done: true,
    detail:
      'Los registros se conservan asociados a la factura que los origina y son consultables y exportables durante el periodo de prescripción.',
  },
  {
    name: 'Remisión de los registros a la AEAT (modalidad VERI*FACTU)',
    done: true,
    detail:
      `Cada registro se remite automáticamente al servicio web VERI*FACTU de la AEAT, en un proceso que se ejecuta cada minuto, autenticado con un certificado electrónico cualificado: el de la propia clínica o, mediante apoderamiento o colaboración social, el de ${SIF_PRODUCER.name}. La respuesta de la AEAT, con su código seguro de verificación, se conserva junto a cada registro.`,
  },
  {
    name: 'Código QR y mención «VERI*FACTU» en la factura',
    done: true,
    detail:
      'Cada factura remitida al entorno de producción de la AEAT lleva en la parte superior el código QR tributario, de 35 mm, generado a partir de su registro de facturación con la dirección del servicio de cotejo de la AEAT, precedido de «QR tributario:» y seguido de la mención «VERI*FACTU».',
  },
]

const pending = requirements.filter(r => !r.done).length

// A complete date, as art. 15.1.l) asks. Read at noon UTC so the server and
// the browser cannot land on different days.
const signedOn = new Date(`${SIF_DECLARATION_SIGNED.date}T12:00:00Z`).toLocaleDateString('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// Art. 15.3: the declaration has to reach the customer on paper or in a
// widely used, free electronic format. The browser's own print dialog gives
// both, as paper or as a PDF.
function printDeclaration() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-surface-page print:bg-white">
    <div class="mx-auto max-w-[760px] px-6 py-16 print:py-0">
      <div class="flex items-center justify-between gap-4 print:hidden">
        <NuxtLink to="/" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">&larr; QuiroFlow</NuxtLink>
        <button
          type="button"
          class="text-[13px] font-medium text-brand-text hover:text-brand-hover"
          @click="printDeclaration"
        >
          Descargar o imprimir (PDF)
        </button>
      </div>

      <div
        v-if="!SIF_DECLARATION_IN_FORCE"
        class="mt-6 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-text"
      >
        <strong>Esta declaración todavía no está en vigor.</strong>
        Quedan {{ pending }} requisitos por implementar, señalados abajo. La obligación es exigible desde el
        <strong>1 de enero de 2027</strong> para contribuyentes del Impuesto sobre Sociedades y desde el 1 de julio de 2027 para el resto
        (RD 1007/2023, redacción dada por el RD-ley 15/2025). Hasta que los requisitos pendientes estén completos, esta página describe el
        estado real del sistema y no constituye la declaración responsable del art. 13.
      </div>

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN</h1>
      <p class="mt-1 text-[13px] text-ink-faint">
        RD 1007/2023 y Orden HAC/1177/2024, artículo 15
      </p>

      <section class="mt-8 text-[13.5px] leading-relaxed text-ink-700" :class="SIF_DECLARATION_IN_FORCE ? '' : 'opacity-70'">
        <dl class="space-y-4">
          <div>
            <dt class="text-ink-muted">a) Nombre del sistema informático de facturación</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_NAME }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">b) Código identificador del sistema informático de facturación</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_CODE }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">c) Identificador completo de la versión</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_VERSION }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">d) Componentes hardware y software, descripción del sistema y de sus principales funcionalidades</dt>
            <dd class="mt-0.5 text-ink-900">
              <ul class="list-disc space-y-1 pl-5">
                <li v-for="component in SIF_COMPONENTS" :key="component">{{ component }}</li>
              </ul>
              <p class="mt-2">{{ SIF_FUNCTIONS }}</p>
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">e) Si ha sido producido para funcionar exclusivamente como VERI*FACTU</dt>
            <dd class="mt-0.5 text-ink-900">
              {{ SIF_ONLY_VERIFACTU === 'S' ? 'Sí' : 'No' }}. Sólo puede funcionar como VERI*FACTU, remitiendo los registros de facturación a la AEAT.
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">f) Si permite ser usado por varios obligados tributarios, o por un mismo usuario para dar soporte a varios obligados tributarios</dt>
            <dd class="mt-0.5 text-ink-900">
              {{ SIF_SUPPORTS_MULTIPLE_OBLIGADOS === 'S' ? 'Sí' : 'No' }}. Cada clínica lleva su propia serie de facturas y su propia cadena de registros, independiente de las demás.
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">g) Tipos de firma utilizados para firmar los registros de facturación y de evento cuando no se usa como VERI*FACTU</dt>
            <dd class="mt-0.5 text-ink-900">
              No aplica: el sistema no puede usarse fuera de la modalidad VERI*FACTU, en la que la remisión autenticada a la AEAT sustituye a la
              firma de los registros.
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">h) Nombre o razón social del productor</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_PRODUCER.name }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">i) NIF del productor</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_PRODUCER.nif }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">j) Dirección postal completa de contacto del productor</dt>
            <dd class="mt-0.5 text-ink-900">{{ SIF_PRODUCER.address }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">k) Declaración de cumplimiento</dt>
            <dd class="mt-0.5 text-ink-900">
              El productor declara que el sistema informático de facturación identificado en esta declaración responsable, en la versión indicada,
              cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria; en el Reglamento que
              establece los requisitos que deben adoptar los sistemas y programas informáticos o electrónicos que soporten los procesos de
              facturación de empresarios y profesionales, y la estandarización de formatos de los registros de facturación, aprobado por el Real
              Decreto 1007/2023, de 5 de diciembre; en la Orden HAC/1177/2024, de 17 de octubre; y en la sede electrónica de la Agencia Estatal de
              Administración Tributaria para todo aquello que complete las especificaciones de dicha orden.
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">l) Fecha y lugar de suscripción</dt>
            <dd class="mt-0.5 text-ink-900">{{ signedOn }}, {{ SIF_DECLARATION_SIGNED.place }}</dd>
          </div>
        </dl>
      </section>

      <h2 class="mt-12 border-t border-line pt-8 text-[17px] font-semibold text-ink-900">Información adicional</h2>

      <section class="mt-6 space-y-8 text-[13.5px] leading-relaxed text-ink-700">
        <div>
          <h3 class="text-[15px] font-semibold text-ink-900">Requisitos y cómo se cumplen</h3>
          <ul class="mt-3 space-y-3">
            <li
              v-for="req in requirements"
              :key="req.name"
              class="rounded-card border px-4 py-3"
              :class="req.done ? 'border-success-border bg-success-bg' : 'border-warning-border bg-warning-bg'"
            >
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-[13.5px] font-semibold" :class="req.done ? 'text-success-deep' : 'text-warning-text'">
                  {{ req.name }}
                </span>
                <span class="shrink-0 text-[12px] font-medium" :class="req.done ? 'text-success-text' : 'text-warning-text'">
                  {{ req.done ? 'Implementado' : 'Pendiente' }}
                </span>
              </div>
              <p class="mt-1.5 text-[13px]" :class="req.done ? 'text-success-deep' : 'text-warning-text'">{{ req.detail }}</p>
            </li>
          </ul>
        </div>

        <div>
          <h3 class="text-[15px] font-semibold text-ink-900">Modalidad y remisión</h3>
          <p class="mt-2">
            {{ SIF_NAME }} funciona en la modalidad <strong>VERI*FACTU</strong>, con remisión de los registros de facturación a la AEAT. La
            remisión autenticada sustituye a la firma electrónica de cada registro y al registro de eventos que exige la modalidad no
            verificable.
          </p>
          <p class="mt-2">
            La remisión puede efectuarla {{ SIF_PRODUCER.name }} por cuenta de cada clínica, mediante apoderamiento o colaboración social,
            con su propio certificado cualificado; las clínicas usuarias no necesitan, por tanto, un certificado electrónico propio para que
            sus registros se remitan. Los registros siguen identificando a la clínica como obligado a la expedición.
          </p>
          <p class="mt-2">
            Cada clínica fija en Ajustes → VeriFactu la fecha desde la que remite al entorno de producción de la AEAT. Hasta esa fecha sus
            registros se remiten al entorno de pruebas de la AEAT y sus facturas no llevan el código QR, que remitiría a un servicio de pruebas.
          </p>
        </div>

        <div>
          <h3 class="text-[15px] font-semibold text-ink-900">Identificación en cada registro</h3>
          <p class="mt-2">
            Estos son los valores que identifican al sistema en el bloque
            <code class="text-ink-700">SistemaInformatico</code> de cada registro remitido:
            <code class="text-ink-700">NombreSistemaInformatico</code> = {{ SIF_SYSTEM_NAME }},
            <code class="text-ink-700">IdSistemaInformatico</code> = {{ SIF_CODE }},
            <code class="text-ink-700">Version</code> = {{ SIF_VERSION }},
            <code class="text-ink-700">TipoUsoPosibleSoloVerifactu</code> = {{ SIF_ONLY_VERIFACTU }},
            <code class="text-ink-700">TipoUsoPosibleMultiOT</code> = {{ SIF_SUPPORTS_MULTIPLE_OBLIGADOS }}.
            <code class="text-ink-700">IndicadorMultiplesOT</code> lo calcula el propio sistema en el momento de generar cada
            registro, como exige el diseño de registro; no es configurable. La huella es SHA-256, formato {{ SIF_HUELLA_SPEC }}.
          </p>
          <p class="mt-2">
            El NIF del productor es un campo obligatorio del mismo bloque en <strong>cada</strong> registro. Productor y obligado tributario
            coinciden en el caso de la clínica que explota la propia sociedad productora; siguen siendo dos papeles distintos: el productor se
            identifica en <code class="text-ink-700">SistemaInformatico</code> y el obligado en <code class="text-ink-700">Cabecera</code>.
          </p>
        </div>

        <div>
          <h3 class="text-[15px] font-semibold text-ink-900">Contacto</h3>
          <p class="mt-2">
            {{ SIF_PRODUCER.name }} — {{ SIF_PRODUCER.address }} —
            <a href="https://quiroflow.com" class="text-brand-text hover:text-brand-hover">quiroflow.com</a>
          </p>
        </div>

        <div class="border-t border-line pt-6 text-[13px] text-ink-faint">
          <p>{{ SIF_NAME }} versión {{ SIF_VERSION }} — España.</p>
        </div>
      </section>
    </div>
  </div>
</template>
