<script setup lang="ts">
import { formatEur, formatGb, meterPercent } from '~/utils/billing'

// Seats, storage and clinics, in three columns.
//
// "Practitioner" is load-bearing in every string here: front desk, practice
// managers and bookkeepers cost nothing and are unlimited, and an owner who
// reads "3 of 4 users" thinks the whole team is capped.
const props = defineProps<{
  practitionerCount: number
  seatAllowance: number | null
  practitionerNames: string[]
  extraSeatPriceCents: number | null
  storageGb: number
  storageAllowanceGb: number | null
  clinicCount: number
  clinicAllowance: number | null
  clinicNames: string[]
  comped: boolean
}>()

const t = useT()

const seatPercent = computed(() => meterPercent(props.practitionerCount, props.seatAllowance))
const storagePercent = computed(() => meterPercent(props.storageGb, props.storageAllowanceGb))
const seatsFree = computed(() => (props.seatAllowance === null ? null : props.seatAllowance - props.practitionerCount))
</script>

<template>
  <SubscriptionCard>
    <div class="flex items-center gap-2.5">
      <h3 class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('What the plan covers', 'Qué incluye el plan') }}</h3>
      <span class="hidden text-[12px] text-ink-muted lg:block">
        {{ t('Front desk, managers and bookkeepers never use a seat', 'Recepción, gerencia y contabilidad no ocupan plaza') }}
      </span>
    </div>

    <div class="mt-4 flex flex-col gap-4 border-t border-line-divider pt-4 lg:flex-row lg:gap-[18px]">
      <!-- Practitioner seats -->
      <div class="flex-1 basis-0">
        <p class="text-[12.5px] font-semibold text-ink-muted">{{ t('Practitioner seats', 'Plazas de profesional') }}</p>
        <p class="mt-2 text-[16px] font-semibold text-ink-900">
          <template v-if="seatAllowance === null">
            {{ t(`${practitionerCount} practitioners`, `${practitionerCount} profesionales`) }}
          </template>
          <template v-else>{{ t(`${practitionerCount} of ${seatAllowance} seats`, `${practitionerCount} de ${seatAllowance} plazas`) }}</template>
        </p>
        <div class="mt-2.5">
          <SubscriptionMeter :percent="seatPercent" />
        </div>
        <p class="mt-2 text-[12px] leading-[1.5] text-ink-muted">
          <span v-if="practitionerNames.length">{{ practitionerNames.join(', ') }}. </span>
          <template v-if="comped || seatAllowance === null">{{ t('No seat limit on this account.', 'Sin límite de plazas en esta cuenta.') }}</template>
          <template v-else-if="seatsFree !== null && seatsFree > 0 && extraSeatPriceCents">
            {{ t(`${seatsFree} free — add another for`, `${seatsFree} libre(s) — añade otra por`) }} {{ formatEur(extraSeatPriceCents) }}{{ t('/mo + IVA.', '/mes + IVA.') }}
          </template>
          <template v-else-if="extraSeatPriceCents">
            {{ t('Every seat is in use — another is', 'Todas las plazas están ocupadas — otra cuesta') }} {{ formatEur(extraSeatPriceCents) }}{{ t('/mo + IVA.', '/mes + IVA.') }}
          </template>
        </p>
      </div>

      <!-- Patient file storage -->
      <div class="flex-1 basis-0 border-t border-line-divider pt-4 lg:border-l lg:border-t-0 lg:pl-[18px] lg:pt-0">
        <p class="text-[12.5px] font-semibold text-ink-muted">{{ t('Patient file storage', 'Archivos de pacientes') }}</p>
        <p class="mt-2 text-[16px] font-semibold text-ink-900">
          {{ formatGb(storageGb) }}<template v-if="storageAllowanceGb">&nbsp;{{ t('of', 'de') }} {{ storageAllowanceGb }} GB</template>
        </p>
        <div class="mt-2.5">
          <SubscriptionMeter :percent="storagePercent" tone="info" />
        </div>
        <!-- No warning tone at any level: nothing blocks an upload, and a red
             meter would promise a gate that does not exist. -->
        <p class="mt-2 text-[12px] leading-[1.5] text-ink-muted">
          {{ t('Headroom, not a gate — uploads are never blocked.', 'Es margen, no un límite — nunca bloqueamos una subida.') }}
        </p>
      </div>

      <!-- Clinics -->
      <div class="flex-1 basis-0 border-t border-line-divider pt-4 lg:border-l lg:border-t-0 lg:pl-[18px] lg:pt-0">
        <p class="text-[12.5px] font-semibold text-ink-muted">{{ t('Clinics', 'Clínicas') }}</p>
        <p class="mt-2 text-[16px] font-semibold text-ink-900">
          <template v-if="clinicAllowance === null">{{ clinicCount }}</template>
          <template v-else>{{ clinicCount }} {{ t('of', 'de') }} {{ clinicAllowance }}</template>
          <span v-if="clinicNames.length === 1" class="font-normal text-ink-muted"> — {{ clinicNames[0] }}</span>
        </p>
        <p class="mt-2 text-[12px] leading-[1.5] text-ink-muted">
          <template v-if="clinicAllowance === null">{{ t('Add as many clinics as you need.', 'Añade tantas clínicas como necesites.') }}</template>
          <template v-else>{{ t('A second clinic needs the Clinic plan.', 'Una segunda clínica requiere el plan Clinic.') }}</template>
        </p>
      </div>
    </div>
  </SubscriptionCard>
</template>
