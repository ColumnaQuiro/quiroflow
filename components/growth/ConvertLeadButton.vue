<script setup lang="ts">
// Converting a lead, from wherever the lead is on screen -- the drawer on
// Growth > Leads, and the lead's thread in the Inbox, where the conversation
// that makes someone a patient usually happens. The button is styled by the
// caller (attributes land on it); the two dialogs are the same everywhere.
//
// What happens next is the point. A lead is converted because they are about
// to come in, so the next thing anyone does is open their record and book
// them. `then: 'ask'` offers both in one question -- book now, or open the
// record -- and `then: 'book'` (the drawer's "Book appointment" on a lead
// who is not a patient yet) goes straight to the calendar, since booking
// was what the click asked for.

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ leadId: string; leadName: string; then?: 'ask' | 'book' }>(), { then: 'ask' })
const emit = defineEmits<{ converted: [patientId: string] }>()

const t = useT()
const { converting, candidates, convert, linkToExisting, createAnyway, dismissCandidates } = useGrowthLeadConvert()

/** Set once converted, while the "book them now?" question is open. */
const convertedTo = ref<string | null>(null)

async function done(patientId: string | null) {
  if (!patientId) return
  if (props.then === 'book') {
    await book(patientId)
    return
  }
  convertedTo.value = patientId
}

// Navigates before telling the parent: the drawer's page closes the drawer on
// `converted`, which unmounts this component, and the navigation should not
// depend on surviving that. If it does go through, nobody is left to tell.
async function leaveFor(patientId: string, to: Parameters<typeof navigateTo>[0]) {
  convertedTo.value = null
  await navigateTo(to)
  emit('converted', patientId)
}
const book = (patientId: string) => leaveFor(patientId, { path: '/calendar', query: { patient: patientId } })
const openRecord = (patientId: string) => leaveFor(patientId, `/patients/${patientId}`)

const onConvert = async () => done(await convert(props.leadId))
const onLink = async (patientId: string) => done(await linkToExisting(props.leadId, patientId))
const onCreateAnyway = async () => done(await createAnyway(props.leadId))
</script>

<template>
  <button v-bind="$attrs" type="button" :disabled="converting" @click="onConvert">
    <slot :converting="converting" />
  </button>

  <!-- A likely duplicate stops the conversion. Silently creating a second
  record for someone who is already a patient splits their history and
  their balance, and someone has to merge it back by hand. -->
  <Teleport to="body">
    <div v-if="candidates.length" class="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/30 p-6" data-test="duplicate-warning" @click.self="dismissCandidates">
      <div class="flex w-full max-w-[420px] flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-popover">
        <div class="flex flex-col gap-1">
          <h3 class="text-[14px] font-semibold tracking-tightTitle text-ink-900">
            {{ t('This person may already be a patient', 'Puede que esta persona ya sea paciente') }}
          </h3>
          <p class="text-[12px] leading-[1.5] text-ink-muted">
            {{ t('Linking keeps one record. Creating a second one splits their history and balance.', 'Vincular mantiene una sola ficha. Crear una segunda divide su historial y su saldo.') }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            v-for="candidate in candidates"
            :key="candidate.id"
            type="button"
            class="flex items-center justify-between gap-2 rounded-ctl border border-line-control bg-surface px-3 py-2 text-left hover:border-brand hover:bg-brand-tint"
            :disabled="converting"
            data-test="link-existing"
            @click="onLink(candidate.id)"
          >
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-[12.5px] font-medium text-ink-900">{{ candidate.name }}</span>
              <span class="text-[10.5px] text-ink-muted">{{ candidate.reason }}</span>
            </span>
            <span class="shrink-0 text-[11px] font-semibold text-brand-text">{{ t('Link', 'Vincular') }}</span>
          </button>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line-divider pt-3">
          <button
            type="button"
            class="text-[11.5px] font-medium text-ink-muted hover:text-ink-700"
            :disabled="converting"
            @click="dismissCandidates"
          >{{ t('Cancel', 'Cancelar') }}</button>
          <button
            type="button"
            class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[11.5px] font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-60"
            :disabled="converting"
            data-test="create-anyway"
            @click="onCreateAnyway"
          >{{ t('Create a new record anyway', 'Crear una ficha nueva igualmente') }}</button>
        </div>
      </div>
    </div>

    <!-- Either answer leaves this screen: there is nothing left to do with
    the lead, and the record is where the person is now. Escape or a click
    outside counts as "not now" and opens the record. -->
    <UiConfirmDialog
      v-if="convertedTo"
      :title="t(`${leadName} is now a patient`, `${leadName} ya es paciente`)"
      :confirm-label="t('Book appointment', 'Reservar cita')"
      :cancel-label="t('Not now, open record', 'Ahora no, abrir ficha')"
      data-test="book-after-convert"
      @confirm="book(convertedTo!)"
      @cancel="openRecord(convertedTo!)"
    >
      <p class="text-[14px] leading-[1.5] text-ink-muted">
        {{ t('Book their first appointment now? You will pick the time on the calendar.', '¿Reservar ahora su primera cita? Elegirás la hora en el calendario.') }}
      </p>
    </UiConfirmDialog>
  </Teleport>
</template>
