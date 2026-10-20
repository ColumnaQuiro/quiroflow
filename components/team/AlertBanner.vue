<script setup lang="ts">
// Every open alert, across the top of every screen, until someone answers
// "On my way" or half an hour passes (utils/teamMessages.openAlerts). The
// person who raised it sees theirs too, so they know it went out, and a
// toast when someone answers.
const t = useT()
const supabase = useSupabaseClient()
const { alerts, me, memberName, acknowledge, messages } = useTeamChat()
const { showToast } = useToast()

const roomNames = ref<Record<string, string>>({})
watch(
  () => alerts.value.map((a) => a.room_id).filter((id): id is string => !!id && !roomNames.value[id]),
  async (ids) => {
    if (!ids.length) return
    const { data } = await supabase.from('calendar_resources').select('id, name').in('id', ids)
    roomNames.value = { ...roomNames.value, ...Object.fromEntries((data ?? []).map((r) => [r.id, r.name])) }
  },
  { immediate: true },
)

// Someone answered MY alert: say who.
const announced = new Set<string>()
watch(
  () => messages.value.filter((m) => m.kind === 'alert' && m.sender_id === me.value && m.acknowledged_at && m.acknowledged_by !== me.value),
  (answered) => {
    for (const m of answered) {
      if (announced.has(m.id)) continue
      announced.add(m.id)
      if (Date.now() - new Date(m.acknowledged_at!).getTime() < 5 * 60_000) showToast(t(`${memberName(m.acknowledged_by)} is on their way.`, `${memberName(m.acknowledged_by)} va para allá.`))
    }
  },
)

const busy = ref<string | null>(null)
async function answer(id: string) {
  busy.value = id
  try {
    await acknowledge(id)
  } catch {
    showToast(t('Could not answer. Go anyway.', 'No se pudo responder. Ve igualmente.'), 'error')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="alerts.length" class="shrink-0" role="alert" aria-live="assertive">
    <div v-for="a in alerts" :key="a.id" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-danger-border bg-danger-text px-4 py-2 text-surface" data-cy="team-alert-banner">
      <span class="text-[14px] font-bold">
        <template v-if="a.sender_id === me">{{ t('Your alert is out · waiting for an answer', 'Tu aviso se ha enviado · esperando respuesta') }}</template>
        <template v-else>{{ t(`${memberName(a.sender_id)} needs help`, `${memberName(a.sender_id)} pide ayuda`) }}<template v-if="a.room_id && roomNames[a.room_id]"> · {{ roomNames[a.room_id] }}</template></template>
      </span>
      <span class="min-w-0 flex-1 truncate text-[13px] opacity-90">{{ a.body }}</span>
      <button v-if="a.sender_id !== me" type="button" data-cy="team-alert-answer" :disabled="busy === a.id" class="h-8 rounded-ctl bg-surface px-3 text-[13px] font-bold text-danger-text hover:opacity-90 disabled:opacity-60 touch:h-11" @click="answer(a.id)">
        {{ t('On my way', 'Voy') }}
      </button>
    </div>
  </div>
</template>
