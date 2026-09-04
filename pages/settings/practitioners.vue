<script setup lang="ts">
interface TeamMemberRow { id: string; full_name: string }
interface UnlinkedName { name: string; count: number; linkTo: string; inviting: boolean; inviteLink: string }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const teamMembers = ref<TeamMemberRow[]>([])
const unlinked = ref<UnlinkedName[]>([])
const loading = ref(true)
const practitionerRoleId = ref('')

const PAGE_SIZE = 1000
async function load() {
  loading.value = true
  const [{ data: tm }, { data: role }] = await Promise.all([
    supabase.from('team_members').select('id, full_name').order('full_name'),
    supabase.from('account_roles').select('id').eq('account_id', store.accountId!).eq('name', 'Practitioner').maybeSingle(),
  ])
  teamMembers.value = tm ?? []
  practitionerRoleId.value = role?.id ?? ''

  const counts = new Map<string, number>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('appointments')
      .select('practitioner_name')
      .is('practitioner_id', null)
      .not('practitioner_name', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const row of data ?? []) {
      if (row.practitioner_name) counts.set(row.practitioner_name, (counts.get(row.practitioner_name) ?? 0) + 1)
    }
    if (!data || data.length < PAGE_SIZE) break
  }
  unlinked.value = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, linkTo: '', inviting: false, inviteLink: '' }))

  loading.value = false
}
onMounted(load)

async function linkToExisting(row: UnlinkedName) {
  if (!row.linkTo) return
  await supabase
    .from('appointments')
    .update({ practitioner_id: row.linkTo })
    .eq('practitioner_name', row.name)
    .is('practitioner_id', null)
  unlinked.value = unlinked.value.filter((u) => u.name !== row.name)
}

async function inviteAsPractitioner(row: UnlinkedName) {
  row.inviting = true
  const { data, error } = await supabase
    .from('account_invites')
    .insert({
      account_id: store.accountId!,
      role: 'practitioner',
      role_id: practitionerRoleId.value || null,
      full_name: row.name,
      link_practitioner_name: row.name,
    })
    .select('token')
    .single()
  row.inviting = false
  if (!error && data) {
    row.inviteLink = `${window.location.origin}/join?token=${data.token}`
  }
}

function copy(text: string) {
  navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Practitioners', 'Profesionales')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t("Migrated appointments sometimes only carry a practitioner's name, not a real account. Link each name to an existing team member, or invite them — the invite link works without an email, and once accepted it automatically re-links their past appointments.", 'Las citas migradas a veces solo llevan el nombre de un profesional, no una cuenta real. Vincula cada nombre a un miembro del equipo existente, o invítalo — el enlace de invitación funciona sin correo electrónico, y una vez aceptado vuelve a vincular automáticamente sus citas pasadas.') }}
          </p>

          <div v-if="loading" class="mt-4 space-y-3">
            <div v-for="i in 3" :key="i" class="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="space-y-1.5">
                <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
                <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
              </div>
              <UiSkeleton class="h-8 w-40 rounded-ctl" />
            </div>
          </div>
          <div v-else-if="unlinked.length === 0" class="mt-6 rounded-card border border-dashed border-line-control bg-surface p-6 text-center text-[13px] text-ink-faint">
            {{ t('Nothing to link — every appointment already has a real practitioner or no name at all.', 'Nada que vincular — todas las citas ya tienen un profesional real o ningún nombre.') }}
          </div>
          <div v-else class="mt-4 space-y-3">
            <div v-for="row in unlinked" :key="row.name" class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">{{ row.name }}</p>
                  <p class="text-[12.5px] text-ink-muted2">{{ row.count }} {{ row.count === 1 ? t('appointment', 'cita') : t('appointments', 'citas') }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <select v-model="row.linkTo" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[12.5px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                    <option value="" disabled>{{ t('Link to team member…', 'Vincular a un miembro del equipo…') }}</option>
                    <option v-for="tm in teamMembers" :key="tm.id" :value="tm.id">{{ tm.full_name }}</option>
                  </select>
                  <button
                    type="button"
                    :disabled="!row.linkTo"
                    class="h-8 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover disabled:opacity-40"
                    @click="linkToExisting(row)"
                  >
                    {{ t('Link', 'Vincular') }}
                  </button>
                  <UiBtn variant="primary" size="sm" :disabled="row.inviting || !!row.inviteLink" @click="inviteAsPractitioner(row)">
                    {{ row.inviting ? t('Creating…', 'Creando…') : t('Invite as new practitioner', 'Invitar como nuevo profesional') }}
                  </UiBtn>
                </div>
              </div>
              <div v-if="row.inviteLink" class="mt-2 rounded-ctl border border-success-border bg-success-bg p-2 text-[12.5px] text-success-deep">
                {{ t('Share this link (e.g. via WhatsApp):', 'Comparte este enlace (p. ej. por WhatsApp):') }} <span class="break-all font-medium">{{ row.inviteLink }}</span>
                <button type="button" class="ml-2 font-medium underline" @click="copy(row.inviteLink)">{{ t('Copy', 'Copiar') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
