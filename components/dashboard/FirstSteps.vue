<script setup lang="ts">
// The way from "account created" to "first visit booked", shown on the
// dashboard to the owner who just signed up.
//
// A new account is a clinic, a room and a trial, and nothing else: no
// appointment types, so neither the calendar nor the booking page can take a
// visit; no patients to put in it. Every widget below this reads zero. These
// three steps are the shortest path to the first thing that is not zero.
//
// Each step is read from the clinic's own data rather than from anything
// clicked here, so doing it any other way (the Settings menu, an import) ticks
// it just the same, and an established clinic, which has all three, never
// sees this at all.
//
// Two steps come and go. Bringing records from other software is offered
// first, optional unless the Import step of onboarding named a source (then
// it is the step to do now) and gone once the clinic said it is starting
// fresh. Linking imported practitioners appears only once an import has left
// visits under a name from the old software rather than a person on the team:
// until they are linked those visits sit in nobody's calendar column.
//
// The one exception is the "done" state. A clinic that has everything would
// otherwise be congratulated on first load, years in; so it only appears in a
// browser that saw at least one step still open.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const loaded = ref(false)
const hasType = ref(false)
const latestPatientId = ref<string | null>(null)
const hasAppointment = ref(false)
const hasImported = ref(false)
const unlinkedVisits = ref(0)
// What onboarding's Import step answered: a source key, 'none', or nothing
// (an account from before that step, or another browser).
const importChoice = ref<string | null>(null)

const dismissed = ref(false)
const sawOpen = ref(false)
const sawLink = ref(false)

// localStorage can throw (private windows, blocked site data). Losing it only
// means the card comes back or the "done" state is skipped, so failures are
// swallowed rather than surfaced.
const storageKey = (what: string) => `first-steps-${what}:${store.accountId}`
function readFlag(what: string) {
  try {
    return localStorage.getItem(storageKey(what)) === '1'
  } catch {
    return false
  }
}
function writeFlag(what: string, value = '1') {
  try {
    localStorage.setItem(storageKey(what), value)
  } catch {
    // ignore
  }
}
function readValue(what: string) {
  try {
    return localStorage.getItem(storageKey(what))
  } catch {
    return null
  }
}

async function load() {
  const [types, patients, appointments, imported, unlinked] = await Promise.all([
    supabase.from('appointment_types').select('id', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('patients').select('id').order('created_at', { ascending: false }).limit(1),
    supabase.from('appointments').select('id', { count: 'exact', head: true }),
    // Every importer stamps external_reference on what it writes; a patient
    // typed in by hand has none.
    supabase.from('patients').select('id', { count: 'exact', head: true }).not('external_reference', 'is', null),
    // The same rows Settings -> Team lists as "Imported names not linked".
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .is('practitioner_id', null)
      .not('practitioner_name', 'is', null)
      .is('deleted_at', null),
  ])
  // A failed read must not invite an established clinic to "add its first
  // patient", so any error hides the card instead of showing a step as open.
  if (types.error || patients.error || appointments.error || imported.error || unlinked.error) {
    dismissed.value = true
    loaded.value = true
    return
  }
  hasType.value = (types.count ?? 0) > 0
  latestPatientId.value = patients.data?.[0]?.id ?? null
  hasAppointment.value = (appointments.count ?? 0) > 0
  hasImported.value = (imported.count ?? 0) > 0
  unlinkedVisits.value = unlinked.count ?? 0
  loaded.value = true
}

onMounted(async () => {
  dismissed.value = readFlag('dismissed')
  sawLink.value = readFlag('link-seen')
  sawOpen.value = readFlag('seen')
  importChoice.value = readValue('import')
  if (dismissed.value) {
    loaded.value = true
    return
  }
  await load()
})

const importSource = computed(() => (['practicehub', 'quirocitas', 'other'].includes(importChoice.value ?? '') ? importChoice.value! : null))
const importSourceName = computed(() =>
  importSource.value === 'practicehub' ? 'PracticeHub' : importSource.value === 'quirocitas' ? 'Quirocitas' : t('a CSV file', 'un archivo CSV'),
)

function startFresh() {
  importChoice.value = 'none'
  writeFlag('import', 'none')
}

interface Step {
  key: string
  done: boolean
  /** Shown, but not needed for the card to count as complete. */
  optional?: boolean
  title: string
  body: string
  action: { label: string; to: string }
  alternative?: { label: string; to?: string; onClick?: () => void }
}

const steps = computed<Step[]>(() => [
  // Before the three below because an import does all of them at once: it
  // brings the types, the patients and their visits.
  ...(importChoice.value === 'none' && !hasImported.value
    ? []
    : [
        {
          key: 'import',
          done: hasImported.value,
          optional: !importSource.value,
          title: importSource.value ? t(`Bring your records from ${importSourceName.value}`, `Trae tus datos desde ${importSourceName.value}`) : t('Coming from other software?', '¿Vienes de otro programa?'),
          body: t(
            'Patients first, then their visits, bonos, invoices and notes. Optional: skip it if you are starting fresh.',
            'Primero los pacientes, luego sus visitas, bonos, facturas y notas. Opcional: sáltalo si empiezas de cero.',
          ),
          action: { label: t('Import', 'Importar'), to: `/settings/import${importSource.value ? `?source=${importSource.value}` : ''}` },
          alternative: { label: t('Starting fresh', 'Empiezo de cero'), onClick: startFresh },
        },
      ]),
  ...(sawLink.value
    ? [
        {
          key: 'link',
          done: unlinkedVisits.value === 0,
          title: t('Link imported practitioners', 'Vincula los profesionales importados'),
          body:
            unlinkedVisits.value === 1
              ? t(
                  '1 visit is under a name from your old software. Link the name to someone on your team, so the visit lands in their column.',
                  '1 visita está a nombre de alguien de tu programa anterior. Vincula el nombre con alguien de tu equipo para que caiga en su columna.',
                )
              : t(
                  `${unlinkedVisits.value} visits are under a name from your old software. Link each name to someone on your team, so the visits land in their column.`,
                  `${unlinkedVisits.value} visitas están a nombre de alguien de tu programa anterior. Vincula cada nombre con alguien de tu equipo para que caigan en su columna.`,
                ),
          action: { label: t('Link names', 'Vincular nombres'), to: '/settings/team#importados' },
        },
      ]
    : []),
  {
    key: 'type',
    done: hasType.value,
    title: t('Add what you offer', 'Añade lo que ofreces'),
    body: t(
      'An appointment type with its length and price. The calendar and your booking page both need one.',
      'Un tipo de cita con su duración y su precio. La agenda y tu página de reservas lo necesitan.',
    ),
    action: { label: t('Add a type', 'Añadir tipo'), to: '/settings/appointment-types?new=1' },
  },
  {
    key: 'patient',
    done: !!latestPatientId.value,
    title: t('Add your first patient', 'Añade tu primer paciente'),
    body: t(
      'A name and a phone number are enough to start.',
      'Con el nombre y un teléfono basta para empezar.',
    ),
    action: { label: t('New patient', 'Nuevo paciente'), to: '/patients?new=1' },
  },
  {
    key: 'visit',
    done: hasAppointment.value,
    title: t('Book their first visit', 'Reserva su primera visita'),
    body: t(
      'Pick a slot in the calendar. The reminder goes out the day before, on its own.',
      'Elige un hueco en la agenda. El recordatorio sale el día antes, solo.',
    ),
    action: {
      label: t('Open the calendar', 'Abrir la agenda'),
      to: latestPatientId.value ? `/calendar?patient=${latestPatientId.value}` : '/calendar',
    },
  },
])

const complete = computed(() => steps.value.every((s) => s.done || s.optional))
// The step to do now: the first open one that is not optional. Earlier steps
// can be done out of order (an import brings patients before any type
// exists), so this is not simply a count of the done ones.
const currentKey = computed(() => steps.value.find((s) => !s.done && !s.optional)?.key ?? null)

// "Your first visit, three steps away" -- counting the steps there are, which
// is no longer always three.
const headingCount = computed(() => {
  const n = steps.value.filter((s) => !s.optional).length
  return [t('three', 'tres'), t('four', 'cuatro'), t('five', 'cinco')][n - 3] ?? String(n)
})

// Only for a clinic still on its first steps (this browser saw one open): a
// clinic that migrated long ago and still has a name or two unlinked must not
// get the card back years in. Once on screen the step stays, ticked, after
// the last name is linked, rather than vanishing the moment it is done.
watch([unlinkedVisits, sawOpen], ([n, open]) => {
  if (n > 0 && open) {
    sawLink.value = true
    writeFlag('link-seen')
  }
})

watch([loaded, complete], ([isLoaded, isComplete]) => {
  if (isLoaded && !isComplete && !dismissed.value) {
    sawOpen.value = true
    writeFlag('seen')
  }
})

const wide = computed(() => steps.value.length > 3)

const visible = computed(() => store.isOwner && loaded.value && !dismissed.value && (!complete.value || sawOpen.value))

function dismiss() {
  dismissed.value = true
  writeFlag('dismissed')
}
</script>

<template>
  <!-- data-ready lets a spec tell "checked and hidden" from "not checked yet". -->
  <div data-cy="first-steps-root" :data-ready="loaded ? 'true' : undefined">
    <section
      v-if="visible"
      class="mb-4 rounded-card border border-line bg-surface shadow-card"
      data-cy="first-steps"
      :data-complete="complete ? 'true' : undefined"
      aria-labelledby="first-steps-heading"
    >
      <!-- Done: one line of acknowledgement and the next thing worth doing,
           instead of three struck-through rows. -->
      <div v-if="complete" class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-success-border bg-success-bg">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-3.5 w-3.5 text-success-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="first-steps-heading" class="text-[14px] font-semibold tracking-tightTitle text-ink-900">
            {{ t('Your first visit is booked', 'Tu primera visita está reservada') }}
          </h2>
          <p class="mt-0.5 text-[12.5px] leading-[1.5] text-ink-muted">
            {{ t('Next, let patients book themselves: turn on online booking for a type and share your page.', 'Ahora, deja que los pacientes reserven solos: activa la reserva online en un tipo y comparte tu página.') }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <NuxtLink
            to="/settings/online-booking"
            class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover touch:h-11"
          >
            {{ t('Online booking', 'Reserva online') }}
          </NuxtLink>
          <UiBtn variant="ghost" data-cy="first-steps-dismiss" @click="dismiss">{{ t('Done', 'Hecho') }}</UiBtn>
        </div>
      </div>

      <template v-else>
        <div class="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div>
            <h2 id="first-steps-heading" class="text-[15px] font-semibold tracking-tightTitle text-ink-900">
              {{ t(`Your first visit, ${headingCount} steps away`, `Tu primera visita, a ${headingCount} pasos`) }}
            </h2>
            <p class="mt-0.5 text-[12.5px] text-ink-muted">
              {{ t('Each one ticks itself off once it is done, however you do it.', 'Cada uno se marca solo cuando está hecho, lo hagas como lo hagas.') }}
            </p>
          </div>
          <button
            type="button"
            class="-mr-1.5 -mt-1 shrink-0 rounded-ctlSm px-1.5 py-1 text-[12px] font-medium text-ink-muted2 hover:bg-surface-subtle hover:text-ink-600"
            data-cy="first-steps-dismiss"
            @click="dismiss"
          >
            {{ t('Hide', 'Ocultar') }}
          </button>
        </div>

        <!-- Three steps sit side by side from md; four or five need lg. -->
        <ol class="mt-3.5 grid grid-cols-1 border-t border-line-divider" :class="wide ? 'lg:auto-cols-fr lg:grid-flow-col' : 'md:grid-cols-3'">
          <li
            v-for="(step, i) in steps"
            :key="step.key"
            class="flex gap-3 border-line-divider px-4 py-3.5 sm:px-5"
            :class="[
              wide ? 'lg:flex-col lg:gap-2.5 lg:py-4' : 'md:flex-col md:gap-2.5 md:py-4',
              i > 0 && (wide ? 'border-t lg:border-l lg:border-t-0' : 'border-t md:border-l md:border-t-0'),
              step.key === currentKey && 'bg-brand-tint/40',
            ]"
            :data-cy="`first-steps-${step.key}`"
            :data-done="step.done ? 'true' : 'false'"
            :aria-current="step.key === currentKey ? 'step' : undefined"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums"
              :class="
                step.done
                  ? 'border border-success-border bg-success-bg text-success-text'
                  : step.key === currentKey
                    ? 'bg-brand text-white'
                    : 'border border-line-control bg-surface text-ink-muted2'
              "
            >
              <svg v-if="step.done" viewBox="0 0 12 12" fill="none" class="h-3 w-3" aria-hidden="true">
                <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <template v-else>{{ i + 1 }}</template>
              <span class="sr-only">{{ step.done ? t('Done', 'Hecho') : t('To do', 'Pendiente') }}</span>
            </span>

            <div class="min-w-0 flex-1">
              <h3 class="text-[13.5px] font-semibold" :class="step.done ? 'text-ink-muted' : 'text-ink-900'">
                {{ step.title }}
                <span v-if="step.optional && !step.done" class="ml-1 text-[11.5px] font-medium text-ink-muted">{{ t('Optional', 'Opcional') }}</span>
              </h3>
              <p v-if="!step.done" class="mt-1 max-w-[42ch] text-[12.5px] leading-[1.5] text-ink-muted">{{ step.body }}</p>

              <div v-if="!step.done" class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                  v-if="step.alternative?.to"
                  :to="step.alternative.to"
                  class="text-[12px] text-ink-muted underline decoration-line-control underline-offset-[3px] hover:text-brand-text hover:decoration-current"
                >
                  {{ step.alternative.label }}
                </NuxtLink>
                <button
                  v-else-if="step.alternative?.onClick"
                  type="button"
                  class="text-[12px] text-ink-muted underline decoration-line-control underline-offset-[3px] hover:text-brand-text hover:decoration-current"
                  :data-cy="`first-steps-${step.key}-alternative`"
                  @click="step.alternative.onClick"
                >
                  {{ step.alternative.label }}
                </button>
              </div>
            </div>
          </li>
        </ol>
      </template>
    </section>
  </div>
</template>
