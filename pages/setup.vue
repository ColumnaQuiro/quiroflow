<script setup lang="ts">
import type { SetupStep } from '~/composables/useSetupChecklist'

// Puesta en marcha: the whole list of what a new clinic sets up, for its
// owner. The dashboard's three first steps get a clinic to its first booked
// visit; this is the rest of what it takes to stop thinking about the
// software -- the migration, WhatsApp (without which no reminder goes out),
// the team, invoicing and VeriFactu, the plan. See useSetupChecklist for how
// each step is read.

const t = useT()
const store = useAccountStore()
const checklist = useSetupChecklist()
const { loaded, failed, steps, settledCount, total, complete } = checklist

onMounted(() => checklist.load())

const groups = computed(() => {
  const labels: Record<SetupStep['group'], string> = {
    clinic: t('Your clinic', 'Tu clínica'),
    patients: t('Your patients', 'Tus pacientes'),
    messages: t('Messages to patients', 'Mensajes a pacientes'),
    billing: t('Invoicing', 'Facturación'),
    account: t('Your account', 'Tu cuenta'),
  }
  const order: SetupStep['group'][] = ['clinic', 'patients', 'messages', 'billing', 'account']
  return order.map((g) => ({ key: g, label: labels[g], steps: steps.value.filter((s) => s.group === g) }))
})

// The step to do now: the first one neither done nor skipped.
const currentKey = computed(() => steps.value.find((s) => !checklist.isSettled(s))?.key ?? null)
const percent = computed(() => (total.value ? Math.round((settledCount.value / total.value) * 100) : 0))

function state(s: SetupStep): 'done' | 'skipped' | 'open' {
  if (s.done) return 'done'
  if (s.skippable && checklist.skipped.value.has(s.key)) return 'skipped'
  return 'open'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="t('Getting set up', 'Puesta en marcha')"
      :meta="loaded && !failed ? t(`${settledCount} of ${total}`, `${settledCount} de ${total}`) : undefined"
    />

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="setup" :data-ready="loaded ? 'true' : undefined">
      <div class="mx-auto max-w-[760px]">
        <template v-if="!store.isOwner">
          <UiEmptyState :title="t('Only the owner sets up the clinic', 'Solo el propietario configura la clínica')" />
        </template>

        <template v-else-if="!loaded">
          <UiSkeleton class="mb-3 h-[72px] w-full" />
          <UiSkeleton class="h-[320px] w-full" />
        </template>

        <p v-else-if="failed" class="rounded-card border border-line bg-surface p-4 text-[13px] text-ink-muted" data-cy="setup-failed">
          {{ t('The list could not be loaded. Reload the page to try again.', 'No se ha podido cargar la lista. Recarga la página para intentarlo de nuevo.') }}
        </p>

        <template v-else>
          <section class="mb-4 rounded-card border border-line bg-surface p-4 shadow-card sm:px-5" aria-labelledby="setup-progress">
            <div class="flex items-baseline justify-between gap-3">
              <h2 id="setup-progress" class="text-[15px] font-semibold tracking-tightTitle text-ink-900">
                {{
                  complete
                    ? t('Your clinic is ready', 'Tu clínica está lista')
                    : t('What is left before the clinic runs on its own', 'Lo que falta para que la clínica funcione sola')
                }}
              </h2>
              <span class="shrink-0 text-[13px] font-semibold tabular-nums text-ink-600">{{ percent }}%</span>
            </div>
            <div
              class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle"
              role="progressbar"
              :aria-valuenow="settledCount"
              aria-valuemin="0"
              :aria-valuemax="total"
              :aria-label="t('Setup progress', 'Progreso de la puesta en marcha')"
            >
              <div class="h-full rounded-full bg-brand transition-[width]" :style="{ width: `${percent}%` }" />
            </div>
            <p class="mt-2.5 text-[12.5px] text-ink-muted">
              {{
                t(
                  'Each step ticks itself off once it is done, from here or from anywhere else. Steps that do not apply to you can be skipped.',
                  'Cada paso se marca solo cuando está hecho, desde aquí o desde cualquier otro sitio. Los que no van contigo se pueden saltar.',
                )
              }}
            </p>
          </section>

          <section
            v-for="group in groups"
            :key="group.key"
            class="mb-4 overflow-hidden rounded-card border border-line bg-surface shadow-card"
            :aria-labelledby="`setup-group-${group.key}`"
          >
            <h3 :id="`setup-group-${group.key}`" class="border-b border-line-divider bg-surface-subtle px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted2 sm:px-5">
              {{ group.label }}
            </h3>
            <ul>
              <li
                v-for="(step, i) in group.steps"
                :key="step.key"
                class="flex gap-3 px-4 py-3.5 sm:px-5"
                :class="[i > 0 && 'border-t border-line-divider', step.key === currentKey && 'bg-brand-tint/40']"
                :data-cy="`setup-${step.key}`"
                :data-state="state(step)"
                :aria-current="step.key === currentKey ? 'step' : undefined"
              >
                <span
                  class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  :class="
                    state(step) === 'done'
                      ? 'border border-success-border bg-success-bg text-success-text'
                      : state(step) === 'skipped'
                        ? 'border border-dashed border-line-control text-ink-muted2'
                        : step.key === currentKey
                          ? 'bg-brand text-white'
                          : 'border border-line-control bg-surface text-ink-muted2'
                  "
                >
                  <svg v-if="state(step) === 'done'" viewBox="0 0 12 12" fill="none" class="h-3 w-3" aria-hidden="true">
                    <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <svg v-else-if="state(step) === 'skipped'" viewBox="0 0 12 12" fill="none" class="h-3 w-3" aria-hidden="true">
                    <path d="M3 6H9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                  <span class="sr-only">{{ state(step) === 'done' ? t('Done', 'Hecho') : state(step) === 'skipped' ? t('Skipped', 'Saltado') : t('To do', 'Pendiente') }}</span>
                </span>

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="text-[13.5px] font-semibold" :class="state(step) === 'open' ? 'text-ink-900' : 'text-ink-muted'">{{ step.title }}</h4>
                    <button
                      v-if="state(step) === 'skipped'"
                      type="button"
                      class="-mr-1.5 -mt-0.5 shrink-0 rounded-ctlSm px-1.5 py-0.5 text-[12px] font-medium text-ink-muted2 hover:bg-surface-subtle hover:text-ink-600"
                      :data-cy="`setup-${step.key}-unskip`"
                      @click="checklist.unskip(step.key)"
                    >
                      {{ t('Undo skip', 'Deshacer') }}
                    </button>
                  </div>
                  <template v-if="state(step) === 'open'">
                    <p class="mt-1 max-w-[60ch] text-[12.5px] leading-[1.5] text-ink-muted">{{ step.body }}</p>
                    <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <NuxtLink
                        :to="step.action.to"
                        class="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-ctl px-3 text-[12.5px] touch:h-10"
                        :class="
                          step.key === currentKey
                            ? 'border border-brand bg-brand font-semibold text-white hover:bg-brand-hover'
                            : 'border border-line-control bg-surface font-medium text-ink-500 hover:border-line-controlHover'
                        "
                      >
                        {{ step.action.label }}
                      </NuxtLink>
                      <NuxtLink
                        v-if="step.alternative"
                        :to="step.alternative.to"
                        class="text-[12px] text-ink-muted underline decoration-line-control underline-offset-[3px] hover:text-brand-text hover:decoration-current"
                      >
                        {{ step.alternative.label }}
                      </NuxtLink>
                      <button
                        v-if="step.skippable"
                        type="button"
                        class="text-[12px] text-ink-muted2 hover:text-ink-600"
                        :data-cy="`setup-${step.key}-skip`"
                        @click="checklist.skip(step.key)"
                      >
                        {{
                          step.key === 'team'
                            ? t('I work alone', 'Trabajo solo/a')
                            : step.key === 'import'
                              ? t('Starting from scratch', 'Empiezo de cero')
                              : t('Not now', 'Ahora no')
                        }}
                      </button>
                    </div>
                  </template>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>
