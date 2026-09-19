<script setup lang="ts">
import {
  SIF_CAN_TRANSMIT,
  SIF_CODE,
  SIF_DECLARATION_IN_FORCE,
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
// meets the requirements. Each one is listed with what actually implements
// it, because a declaration that only says "cumple" tells an inspector
// nothing and tells a clinic less.
//
// The requirements that are not met yet say so. A declaración responsable is
// a statement with legal effect: claiming remisión to the AEAT that does not
// happen would be a false one, and the fact that nobody would notice until
// an inspection is the reason to be exact rather than a reason not to be.
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
    done: false,
    detail:
      'Pendiente. Requiere un certificado electrónico cualificado y la conexión con el servicio web de la AEAT.',
  },
  {
    name: 'Código QR y mención «VERI*FACTU» en la factura',
    done: false,
    detail:
      'Pendiente, y deliberadamente no impreso hasta entonces: la mención «Factura verificable en la sede electrónica de la AEAT» sólo corresponde a un sistema que efectivamente remite los registros.',
  },
]

const pending = requirements.filter(r => !r.done).length
</script>

<template>
  <div class="min-h-screen bg-surface-page">
    <div class="mx-auto max-w-[760px] px-6 py-16">
      <NuxtLink to="/" class="text-[13px] font-medium text-brand-text hover:text-brand-hover">&larr; QuiroFlow</NuxtLink>

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

      <h1 class="mt-8 text-2xl font-semibold text-ink-900">Declaración responsable</h1>
      <p class="mt-1 text-[13px] text-ink-faint">
        Sistema informático de facturación (SIF) — RD 1007/2023 y Orden HAC/1177/2024
      </p>

      <section class="mt-8 space-y-8 text-[13.5px] leading-relaxed text-ink-700">
        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">1. Identificación del sistema</h2>
          <dl class="mt-3 grid grid-cols-[minmax(0,180px)_1fr] gap-x-4 gap-y-2">
            <dt class="text-ink-muted">Denominación</dt>
            <dd class="text-ink-900">{{ SIF_NAME }}</dd>
            <dt class="text-ink-muted">Código</dt>
            <dd class="text-ink-900">{{ SIF_CODE }}</dd>
            <dt class="text-ink-muted">Versión</dt>
            <dd class="text-ink-900">{{ SIF_VERSION }}</dd>
            <dt class="text-ink-muted">Formato de huella</dt>
            <dd class="text-ink-900">SHA-256 — {{ SIF_HUELLA_SPEC }}</dd>
          </dl>

          <p class="mt-4 text-[13px] text-ink-muted">
            Estos son los valores que identifican al sistema en el bloque
            <code class="text-ink-700">SistemaInformatico</code> de cada registro remitido:
            <code class="text-ink-700">NombreSistemaInformatico</code> = {{ SIF_SYSTEM_NAME }},
            <code class="text-ink-700">IdSistemaInformatico</code> = {{ SIF_CODE }},
            <code class="text-ink-700">TipoUsoPosibleSoloVerifactu</code> = {{ SIF_ONLY_VERIFACTU }},
            <code class="text-ink-700">TipoUsoPosibleMultiOT</code> = {{ SIF_SUPPORTS_MULTIPLE_OBLIGADOS }}.
            <code class="text-ink-700">IndicadorMultiplesOT</code> lo calcula el propio sistema en el momento de generar cada
            registro, como exige el diseño de registro; no es configurable.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">2. Identificación del productor</h2>
          <dl class="mt-3 grid grid-cols-[minmax(0,180px)_1fr] gap-x-4 gap-y-2">
            <dt class="text-ink-muted">Productor</dt>
            <dd class="text-ink-900">{{ SIF_PRODUCER.name }}</dd>
            <dt class="text-ink-muted">NIF</dt>
            <dd :class="SIF_PRODUCER.nif ? 'text-ink-900' : 'text-warning-text'">
              {{ SIF_PRODUCER.nif || '[pendiente de confirmar la entidad que comercializa QuiroFlow]' }}
            </dd>
            <dt class="text-ink-muted">Domicilio</dt>
            <dd :class="SIF_PRODUCER.address ? 'text-ink-900' : 'text-warning-text'">
              {{ SIF_PRODUCER.address || '[pendiente]' }}
            </dd>
          </dl>

          <p v-if="!SIF_CAN_TRANSMIT" class="mt-3 text-[13px] text-warning-text">
            El NIF del productor no es sólo un dato de esta página: es un campo obligatorio del bloque
            <code>SistemaInformatico</code> de <strong>cada</strong> registro remitido a la AEAT. Mientras no esté confirmado, no puede
            iniciarse la remisión.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">3. Requisitos y estado</h2>
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
          <h2 class="text-[15px] font-semibold text-ink-900">4. Modalidad prevista</h2>
          <p class="mt-2">
            {{ SIF_NAME }} adoptará la modalidad <strong>VERI*FACTU</strong>, con remisión de los registros de facturación a la AEAT. La
            remisión autenticada sustituye a la firma electrónica de cada registro y al registro de eventos que exige la modalidad no
            verificable, requisitos que de otro modo habría que implementar además de la cadena de huellas que ya existe.
          </p>
          <p class="mt-2">
            La remisión podrá efectuarla {{ SIF_NAME }} por cuenta de cada clínica mediante representación, apoderamiento o colaboración
            social, utilizando un certificado cualificado propio. Las clínicas usuarias no necesitan, por tanto, un certificado electrónico
            propio para que sus registros se remitan.
          </p>
        </div>

        <div>
          <h2 class="text-[15px] font-semibold text-ink-900">5. Declaración</h2>
          <p class="mt-2" :class="SIF_DECLARATION_IN_FORCE ? '' : 'text-ink-muted'">
            El productor identificado en el apartado 2 declara bajo su responsabilidad que el sistema identificado en el apartado 1 cumple lo
            dispuesto en el artículo 29.2.j) de la Ley 58/2003, General Tributaria, y en el Reglamento aprobado por el RD 1007/2023, y que los
            registros de facturación que genera son íntegros, conservados, accesibles, legibles, trazables e inalterables.
          </p>
          <p v-if="!SIF_DECLARATION_IN_FORCE" class="mt-2 text-[13px] text-warning-text">
            Texto previsto. No surte efecto mientras figuren requisitos pendientes en el apartado 3.
          </p>
        </div>

        <div class="border-t border-line pt-6 text-[13px] text-ink-faint">
          <p>Versión {{ SIF_VERSION }} — España.</p>
        </div>
      </section>
    </div>
  </div>
</template>
