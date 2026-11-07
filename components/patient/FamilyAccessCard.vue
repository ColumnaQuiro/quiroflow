<script setup lang="ts">
// Who may act for me, and whom I act for -- with a way out of either.
// Granting is the clinic's (Familia on the ficha); letting go is anybody's:
// the person managed, because it is their record, and the manager, because
// it is their screen (withdraw_patient_manager). Renders nothing for a login
// with no links, which is nearly everyone.
const supabase = useSupabaseClient()
const t = useT()
const { others, reload: reloadFamily } = useFamily()

interface Manager {
  link_id: string
  manager_first_name: string
  manager_last_name: string | null
  access: string
}
const managers = ref<Manager[]>([])
const busy = ref<string | null>(null)
const error = ref('')

async function loadManagers() {
  const { data } = await supabase.rpc('get_my_managers')
  managers.value = (data ?? []) as Manager[]
}
onMounted(loadManagers)

// Two taps: the first asks, the second lets go. Only the clinic can put a
// link back, so it should not go on a stray tap.
const confirming = ref<string | null>(null)
async function withdraw(linkId: string) {
  if (confirming.value !== linkId) {
    confirming.value = linkId
    return
  }
  confirming.value = null
  busy.value = linkId
  error.value = ''
  const { data, error: e } = await supabase.rpc('withdraw_patient_manager', { p_link_id: linkId })
  busy.value = null
  if (e || !data) {
    error.value = t("Couldn't remove the access. Try again.", 'No se ha podido quitar el acceso. Inténtalo de nuevo.')
    return
  }
  await Promise.all([loadManagers(), reloadFamily()])
}

const name = (first: string, last: string | null) => [first, last].filter(Boolean).join(' ')
</script>

<template>
  <PatientCard v-if="managers.length || others.length" :title="t('Family', 'Familia')" data-cy="family-access-card">
    <div v-if="others.length">
      <p class="text-[12.5px] text-ink-muted">{{ t('You can manage these accounts:', 'Puedes gestionar estas cuentas:') }}</p>
      <ul class="mt-1.5 space-y-1">
        <li v-for="p in others" :key="p.patientId" class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[13.5px] text-ink-900">
            {{ personName(p) }}<span class="text-ink-muted"> · {{ p.access === 'admin' ? t('visits and payments', 'citas y pagos') : t('full access', 'acceso completo') }}</span>
          </span>
          <button
            v-if="p.linkId"
            type="button"
            class="shrink-0 text-[12.5px] font-semibold text-ink-muted disabled:opacity-50"
            :disabled="busy === p.linkId"
            :data-cy="`family-stop-${p.firstName}`"
            @click="withdraw(p.linkId)"
          >
            {{ busy === p.linkId ? t('Removing…', 'Quitando…') : confirming === p.linkId ? t('Yes, stop managing', 'Sí, dejar de gestionar') : t('Stop managing', 'Dejar de gestionar') }}
          </button>
        </li>
      </ul>
    </div>
    <div v-if="managers.length" :class="others.length ? 'mt-4 border-t border-line-divider pt-3' : ''">
      <p class="text-[12.5px] text-ink-muted">{{ t('These people can manage your account:', 'Estas personas pueden gestionar tu cuenta:') }}</p>
      <ul class="mt-1.5 space-y-1.5">
        <li v-for="m in managers" :key="m.link_id" class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[13.5px] text-ink-900">
            {{ name(m.manager_first_name, m.manager_last_name) }}<span class="text-ink-muted"> · {{ m.access === 'admin' ? t('visits and payments', 'citas y pagos') : t('full access', 'acceso completo') }}</span>
          </span>
          <button
            type="button"
            class="shrink-0 text-[12.5px] font-semibold text-danger-text disabled:opacity-50"
            :disabled="busy === m.link_id"
            :data-cy="`family-withdraw-${m.manager_first_name}`"
            @click="withdraw(m.link_id)"
          >
            {{ busy === m.link_id ? t('Removing…', 'Quitando…') : confirming === m.link_id ? t('Yes, remove access', 'Sí, quitar acceso') : t('Remove access', 'Quitar acceso') }}
          </button>
        </li>
      </ul>
    </div>
    <!-- withdraw(): only the clinic can link the two records again. -->
    <p v-if="confirming" class="mt-2 text-[12px] text-ink-muted" role="status">{{ t('Only the clinic can link the accounts again.', 'Solo la clínica puede volver a vincular las cuentas.') }}</p>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
  </PatientCard>
</template>
