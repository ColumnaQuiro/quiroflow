<script setup lang="ts">
// Every open help alert, across the top of every staff screen, until someone
// answers "Voy" or half an hour passes (utils/teamMessages.openAlerts) -- the
// web's components/team/AlertBanner.vue. The person who raised it sees theirs
// too, so they know it went out, and then who is coming: the web says that in
// a toast, which this app does not have, so here it is a line of its own for
// a few minutes.
const t = useT()
const supabase = useSupabaseClient()
const { alerts, messages, me, now, memberName, acknowledge } = useStaffTeamChat()

const roomNames = ref<Record<string, string>>({})
watch(
  () => alerts.value.map((a) => a.room_id).filter((id): id is string => !!id && !roomNames.value[id]),
  async (ids) => {
    if (!ids.length) return
    const { data } = await supabase.from('calendar_resources').select('id, name').in('id', ids)
    roomNames.value = { ...roomNames.value, ...Object.fromEntries(((data as { id: string; name: string }[] | null) ?? []).map((r) => [r.id, r.name])) }
  },
  { immediate: true },
)

// Someone answered MY alert in the last few minutes: say who, until closed.
const dismissed = ref<Set<string>>(new Set())
const answeredMine = computed(() =>
  messages.value.filter(
    (m) => m.kind === 'alert' && m.sender_id === me.value && m.acknowledged_at && m.acknowledged_by !== me.value && !dismissed.value.has(m.id) && now.value - new Date(m.acknowledged_at).getTime() < 5 * 60_000,
  ),
)

const busy = ref<string | null>(null)
const failed = ref<string | null>(null)
async function answer(id: string) {
  busy.value = id
  failed.value = null
  try {
    await acknowledge(id)
  } catch {
    failed.value = id
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="alerts.length || answeredMine.length" class="shrink-0" role="alert" aria-live="assertive">
    <div v-for="a in alerts" :key="a.id" class="flex items-center gap-3 border-b border-danger-border bg-danger-text px-4 py-2.5 text-white" data-cy="team-alert-banner">
      <div class="min-w-0 flex-1">
        <p class="text-[14px] font-bold leading-snug">
          <template v-if="a.sender_id === me">{{ t('Your alert is out · waiting for an answer', 'Tu aviso se ha enviado · esperando respuesta') }}</template>
          <template v-else>{{ t(`${memberName(a.sender_id)} needs help`, `${memberName(a.sender_id)} pide ayuda`) }}<template v-if="a.room_id && roomNames[a.room_id]"> · {{ roomNames[a.room_id] }}</template></template>
        </p>
        <p class="truncate text-[13px] opacity-90">{{ a.body }}</p>
        <p v-if="failed === a.id" class="text-[12.5px] font-semibold">{{ t('Could not answer. Go anyway.', 'No se pudo responder. Ve igualmente.') }}</p>
      </div>
      <button
        v-if="a.sender_id !== me"
        type="button"
        class="h-11 shrink-0 rounded-ctl bg-white px-4 text-[14px] font-bold text-danger-text active:opacity-80 disabled:opacity-60"
        :disabled="busy === a.id"
        data-cy="team-alert-answer"
        @click="answer(a.id)"
      >
        {{ t('On my way', 'Voy') }}
      </button>
    </div>
    <div v-for="m in answeredMine" :key="m.id" class="flex items-center gap-3 border-b border-success-border bg-success-bg px-4 py-2 text-success-text" data-cy="team-alert-answered">
      <p class="min-w-0 flex-1 text-[14px] font-semibold">{{ t(`${memberName(m.acknowledged_by)} is on their way.`, `${memberName(m.acknowledged_by)} va para allá.`) }}</p>
      <button type="button" class="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center" :aria-label="t('Close', 'Cerrar')" @click="dismissed = new Set([...dismissed, m.id])">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  </div>
</template>
