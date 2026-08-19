<script setup lang="ts">
interface TeamMemberRow { id: string; full_name: string }
interface UnlinkedName { name: string; count: number; linkTo: string; inviting: boolean; inviteLink: string }

const supabase = useSupabaseClient()
const store = useAccountStore()

const teamMembers = ref<TeamMemberRow[]>([])
const unlinked = ref<UnlinkedName[]>([])
const loading = ref(true)

const PAGE_SIZE = 1000
async function load() {
  loading.value = true
  const [{ data: tm }] = await Promise.all([supabase.from('team_members').select('id, full_name').order('full_name')])
  teamMembers.value = tm ?? []

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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Practitioners</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      Migrated appointments sometimes only carry a practitioner's name, not a real account. Link each name to an
      existing team member, or invite them — the invite link works without an email, and once accepted it
      automatically re-links their past appointments.
    </p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <div v-else-if="unlinked.length === 0" class="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
      Nothing to link — every appointment already has a real practitioner or no name at all.
    </div>
    <div v-else class="mt-4 space-y-3">
      <div v-for="row in unlinked" :key="row.name" class="rounded-lg border border-gray-200 bg-white p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900">{{ row.name }}</p>
            <p class="text-xs text-gray-500">{{ row.count }} appointment{{ row.count === 1 ? '' : 's' }}</p>
          </div>
          <div class="flex items-center gap-2">
            <select v-model="row.linkTo" class="rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="" disabled>Link to team member…</option>
              <option v-for="tm in teamMembers" :key="tm.id" :value="tm.id">{{ tm.full_name }}</option>
            </select>
            <button
              type="button"
              :disabled="!row.linkTo"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              @click="linkToExisting(row)"
            >
              Link
            </button>
            <button
              type="button"
              :disabled="row.inviting || !!row.inviteLink"
              class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              @click="inviteAsPractitioner(row)"
            >
              {{ row.inviting ? 'Creating…' : 'Invite as new practitioner' }}
            </button>
          </div>
        </div>
        <div v-if="row.inviteLink" class="mt-2 rounded-md bg-green-50 p-2 text-xs text-green-800">
          Share this link (e.g. via WhatsApp): <span class="break-all font-medium">{{ row.inviteLink }}</span>
          <button type="button" class="ml-2 font-medium underline" @click="copy(row.inviteLink)">Copy</button>
        </div>
      </div>
    </div>
  </div>
</template>
