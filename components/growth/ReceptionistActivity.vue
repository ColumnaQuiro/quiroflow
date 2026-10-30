<script setup lang="ts">
import { handoverReason, type ReceptionistActivity, type ReceptionistEvent } from '~/utils/receptionistActivity'

// What the receptionist did: this month in numbers, and the last things it
// did one by one, each opening the conversation it did it in. Read back
// from the notes it leaves in the threads (server/utils/receptionistActivity.ts),
// so nothing here is claimed that the Inbox does not show.
const props = defineProps<{
  /** Null only while the page's own request has not answered. */
  activity: ReceptionistActivity | null
}>()
defineEmits<{ reload: [] }>()

const t = useT()

const tiles = computed(() => {
  const a = props.activity
  if (!a) return []
  return [
    { key: 'sent', value: a.month.sent, label: t('Replies sent', 'Respuestas enviadas'), to: null },
    { key: 'drafted', value: a.month.drafted, label: t('Drafts written', 'Borradores escritos'), to: null },
    { key: 'booked', value: a.booked + a.moved, label: t('Visits booked or moved', 'Citas reservadas o movidas'), to: null },
    { key: 'handed-over', value: a.handedOver, label: t('Handed to a person', 'Pasadas a una persona'), to: null },
  ]
})

const waiting = computed(() => {
  const a = props.activity
  if (!a) return []
  return [
    { key: 'drafts-waiting', value: a.draftsWaiting, label: t('drafts waiting for approval', 'borradores esperando aprobación'), to: '/inbox?ai=draft_ready' },
    { key: 'handovers-open', value: a.handoversOpen, label: t('handovers nobody has picked up', 'traspasos que nadie ha atendido'), to: '/inbox?ai=needs_human' },
  ]
})

function label(event: ReceptionistEvent): string {
  switch (event.kind) {
    case 'booked': return t('Booked a visit', 'Reservó una cita')
    case 'moved': return t('Moved a visit', 'Movió una cita')
    case 'cancelled': return t('Cancelled a visit', 'Canceló una cita')
    case 'waitlisted': return t('Added to the waiting list', 'Apuntó a la lista de espera')
    case 'handover': return t('Handed to a person', 'Pasó a una persona')
    default: return t('Left a note', 'Dejó una nota')
  }
}

const TONE: Record<ReceptionistEvent['kind'], string> = {
  booked: 'bg-success-accent',
  moved: 'bg-success-accent',
  cancelled: 'bg-danger-text',
  waitlisted: 'bg-info-accent',
  handover: 'bg-warning-accent',
  note: 'bg-ink-faint3',
}

function when(at: string) {
  return new Date(at).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The part of the note worth reading in a list: a handover's reason, otherwise the note. */
function detail(event: ReceptionistEvent) {
  return event.kind === 'handover' ? handoverReason(event.body) : event.body
}
</script>

<template>
  <GrowthSettingCard :title="t('What it has done', 'Qué ha hecho')" :action="t('Refresh', 'Actualizar')" @action="$emit('reload')">
    <div v-if="!activity" class="grid animate-pulse gap-2 sm:grid-cols-4" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="h-14 rounded-ctl bg-surface-subtle" />
    </div>

    <template v-else>
      <dl class="grid gap-2 sm:grid-cols-4" data-test="activity-month">
        <div v-for="tile in tiles" :key="tile.key" class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
          <dd class="text-[16px] font-semibold text-ink-900" :data-test="`activity-${tile.key}`">{{ tile.value.toLocaleString('es-ES') }}</dd>
          <dt class="text-[11px] text-ink-muted">{{ tile.label }}</dt>
        </div>
      </dl>
      <p class="text-[11px] text-ink-faint">{{ t('This month. Each reply it writes counts towards the allowance, sent or left as a draft.', 'Este mes. Cada respuesta que escribe cuenta para el cupo, enviada o como borrador.') }}</p>

      <!-- What is waiting on a person right now: the two queues the
      receptionist creates, each a link to the Inbox filtered to it. -->
      <ul class="flex flex-col gap-1 border-t border-line-divider pt-2.5" data-test="activity-waiting">
        <li v-for="item in waiting" :key="item.key" class="flex items-center gap-2 text-[12px]">
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="item.value ? 'bg-warning-accent' : 'bg-toggle-off'" />
          <NuxtLink v-if="item.value" :to="item.to" class="text-ink-700 hover:text-brand-text hover:underline" :data-test="item.key">
            <strong class="font-semibold">{{ item.value }}</strong> {{ item.label }} →
          </NuxtLink>
          <span v-else class="text-ink-muted" :data-test="item.key"><strong class="font-semibold">0</strong> {{ item.label }}</span>
        </li>
      </ul>

      <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
        <span class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Most recent', 'Lo más reciente') }}</span>
        <p v-if="!activity.recent.length" class="text-[11.5px] text-ink-muted" data-test="activity-empty">
          {{ t('Nothing yet. What it books, moves or hands over appears here, with a note in the conversation.', 'Nada todavía. Lo que reserve, mueva o pase a una persona aparece aquí, con una nota en la conversación.') }}
        </p>
        <ol v-else class="flex flex-col divide-y divide-line-divider" data-test="activity-recent">
          <li v-for="event in activity.recent" :key="event.id" class="py-1.5">
            <NuxtLink :to="`/inbox?open=${encodeURIComponent(event.conversationKey)}`" class="group flex items-start gap-2.5" :data-test="`activity-event-${event.kind}`">
              <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" :class="TONE[event.kind]" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span class="font-semibold text-ink-900 group-hover:text-brand-text">{{ label(event) }}</span>
                  <span v-if="event.name" class="text-ink-700">· {{ event.name }}</span>
                  <span class="text-[11px] text-ink-faint">{{ when(event.at) }}</span>
                </span>
                <span class="line-clamp-2 text-[11.5px] leading-[1.45] text-ink-muted">{{ detail(event) }}</span>
              </span>
            </NuxtLink>
          </li>
        </ol>
      </div>
    </template>
  </GrowthSettingCard>
</template>
