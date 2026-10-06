<script setup lang="ts">
// Profile > Avisos: which pushes this person gets (staff_push_preferences,
// read by server/utils/staffPush.ts). Saved as each switch flips. No row yet
// means the table's defaults, shown here the same way.
const supabase = useSupabaseClient()
const t = useT()
const { context, can } = usePractitionerContext()

type Key = 'online_bookings' | 'changes' | 'inbox' | 'check_in' | 'morning_summary' | 'quiet_hours'
const prefs = reactive<Record<Key, boolean>>({ online_bookings: true, changes: true, inbox: true, check_in: false, morning_summary: true, quiet_hours: false })
const loaded = ref(false)
const loadFailed = ref(false)
const error = ref('')

async function load() {
  if (!context.value) return
  loadFailed.value = false
  const { data, error: readError } = await supabase
    .from('staff_push_preferences')
    .select('online_bookings, changes, inbox, check_in, morning_summary, quiet_hours')
    .eq('team_member_id', context.value.teamMemberId)
    .maybeSingle()
  // A failed read must not look like the defaults: flipping one switch then
  // wrote every default over the person's saved choices.
  if (readError) {
    loadFailed.value = true
    return
  }
  if (data) Object.assign(prefs, data)
  loaded.value = true
}
const stop = watch(() => context.value?.teamMemberId, (id) => {
  if (!id) return
  load()
  nextTick(() => stop())
}, { immediate: true })

async function flip(key: Key) {
  if (!context.value) return
  prefs[key] = !prefs[key]
  error.value = ''
  const { error: e } = await supabase
    .from('staff_push_preferences')
    .upsert({ team_member_id: context.value.teamMemberId, account_id: context.value.accountId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'team_member_id' })
  if (e) {
    prefs[key] = !prefs[key]
    error.value = t('Could not save. Try again.', 'No se ha podido guardar. Inténtalo de nuevo.')
  }
}

// Inbox pushes only ever go to people who can see the Inbox.
const rows = computed(() =>
  ([
    { key: 'online_bookings' as const, label: t('New online bookings', 'Citas nuevas online') },
    { key: 'changes' as const, label: t('Cancellations and changes', 'Cancelaciones y cambios') },
    can('inbox_access') ? { key: 'inbox' as const, label: t('Inbox messages', 'Mensajes en la Bandeja') } : null,
    { key: 'check_in' as const, label: t('A patient checking in', 'Paciente que llega (check-in)') },
    { key: 'morning_summary' as const, label: t('Summary of the day at 8:00', 'Resumen del día a las 8:00') },
  ] as ({ key: Key; label: string } | null)[]).filter((r): r is { key: Key; label: string } => !!r),
)
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card px-4 py-3.5" data-cy="staff-push-settings">
    <p class="text-[13.5px] font-medium text-ink-900">{{ t('Notifications', 'Avisos') }}</p>
    <p class="mt-0.5 text-[12px] leading-snug text-ink-muted">{{ t('Only about your patients and your diary.', 'Solo de tus pacientes y tu agenda.') }}</p>
    <div class="mt-1.5 divide-y divide-line-row" :class="loaded ? '' : 'opacity-60'">
      <button
        v-for="r in rows"
        :key="r.key"
        type="button"
        role="switch"
        :aria-checked="prefs[r.key]"
        class="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        :disabled="!loaded"
        :data-cy="`push-${r.key}`"
        @click="flip(r.key)"
      >
        <span class="text-[14px] text-ink-900">{{ r.label }}</span>
        <span class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors" :class="prefs[r.key] ? 'bg-brand' : 'bg-line-control'">
          <span class="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-card transition-all" :class="prefs[r.key] ? 'left-[21px]' : 'left-[3px]'" />
        </span>
      </button>
    </div>
    <p class="mt-3 text-[13.5px] font-medium text-ink-900">{{ t('Do not disturb', 'No molestar') }}</p>
    <button type="button" role="switch" :aria-checked="prefs.quiet_hours" class="flex min-h-11 w-full items-center justify-between gap-3 text-left" :disabled="!loaded" data-cy="push-quiet_hours" @click="flip('quiet_hours')">
      <span>
        <span class="block text-[14px] text-ink-900">{{ t('Outside my working hours', 'Fuera de mi horario') }}</span>
        <span class="block text-[12px] text-ink-muted">{{ t('Except the 8:00 summary.', 'Salvo el resumen de las 8:00.') }}</span>
      </span>
      <span class="relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors" :class="prefs.quiet_hours ? 'bg-brand' : 'bg-line-control'">
        <span class="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-card transition-all" :class="prefs.quiet_hours ? 'left-[21px]' : 'left-[3px]'" />
      </span>
    </button>
    <p v-if="error" role="alert" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
    <p v-if="loadFailed" role="alert" class="mt-1 text-[12.5px] text-danger-text">
      {{ t('Could not load your settings.', 'No se han podido cargar tus avisos.') }}
      <button type="button" class="ml-1 font-semibold text-brand-text" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
  </div>
</template>
