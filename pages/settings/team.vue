<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

interface RoleOption {
  id: string
  name: string
}

const members = ref<Tables<'team_members'>[]>([])
const invites = ref<Tables<'account_invites'>[]>([])
const roles = ref<RoleOption[]>([])
const loading = ref(true)

const inviteEmail = ref('')
const inviteRoleId = ref('')
const inviting = ref(false)
const error = ref('')
const lastInviteLink = ref('')
const emailStatus = ref<'sent' | 'failed' | ''>('')

const roleName = computed(() => {
  const byId = new Map(roles.value.map((r) => [r.id, r.name]))
  return (roleId: string | null) => (roleId ? (byId.get(roleId) ?? 'Unknown role') : 'No role')
})

async function load() {
  loading.value = true
  const [{ data: m }, { data: i }, { data: r }] = await Promise.all([
    supabase.from('team_members').select('*').order('full_name'),
    supabase.from('account_invites').select('*').is('accepted_at', null).order('created_at', { ascending: false }),
    supabase.from('account_roles').select('id, name').order('is_system', { ascending: false }).order('name'),
  ])
  members.value = m ?? []
  invites.value = i ?? []
  roles.value = r ?? []
  if (!inviteRoleId.value && roles.value.length > 0) {
    inviteRoleId.value = roles.value.find((role) => role.name === 'Practitioner')?.id ?? roles.value[0].id
  }
  loading.value = false
}
onMounted(load)

async function createInvite() {
  error.value = ''
  lastInviteLink.value = ''
  emailStatus.value = ''
  inviting.value = true
  const email = inviteEmail.value.trim()
  if (!email) {
    inviting.value = false
    error.value = 'Email is required.'
    return
  }
  const { data, error: insertError } = await supabase
    .from('account_invites')
    .insert({
      account_id: store.accountId!,
      email,
      role_id: inviteRoleId.value,
      // Legacy column still has a check constraint (owner/practitioner/front_desk) and is
      // no longer the source of truth for permissions — role_id above is. This is just a
      // safe placeholder so the insert satisfies the constraint.
      role: 'practitioner',
    })
    .select('id, token')
    .single()

  if (insertError) {
    inviting.value = false
    error.value = insertError.message
    return
  }
  lastInviteLink.value = `${window.location.origin}/join?token=${data.token}`
  inviteEmail.value = ''

  if (email) {
    try {
      await $fetch('/api/invites/send', { method: 'POST', body: { inviteId: data.id } })
      emailStatus.value = 'sent'
    } catch {
      emailStatus.value = 'failed'
    }
  }

  inviting.value = false
  await load()
}

async function revokeInvite(id: string) {
  await supabase.from('account_invites').delete().eq('id', id)
  await load()
}

async function toggleBookable(member: Tables<'team_members'>) {
  const next = !member.online_booking_enabled
  member.online_booking_enabled = next
  await supabase.from('team_members').update({ online_booking_enabled: next }).eq('id', member.id)
}

const editingId = ref<string | null>(null)
const editingName = ref('')
function startEdit(member: Tables<'team_members'>) {
  editingId.value = member.id
  editingName.value = member.full_name
}
async function saveEdit(member: Tables<'team_members'>) {
  const name = editingName.value.trim()
  editingId.value = null
  if (!name || name === member.full_name) return
  member.full_name = name
  await supabase.from('team_members').update({ full_name: name }).eq('id', member.id)
}

function inviteLink(token: string) {
  return `${window.location.origin}/join?token=${token}`
}

function copy(text: string) {
  navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Team Members</h1>

    <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Name</th>
            <th class="px-4 py-2">Role</th>
            <th class="px-4 py-2">Online booking</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="loading">
            <td colspan="3" class="px-4 py-6 text-center text-gray-400">Loading…</td>
          </tr>
          <tr v-for="m in members" v-else :key="m.id">
            <td class="px-4 py-2.5 text-gray-900">
              <span class="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" :style="{ backgroundColor: m.color }"></span>
              <input
                v-if="editingId === m.id"
                v-model="editingName"
                type="text"
                autofocus
                class="w-48 rounded border border-indigo-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                @keydown.enter="saveEdit(m)"
                @keydown.esc="editingId = null"
                @blur="saveEdit(m)"
              />
              <button v-else type="button" class="hover:text-indigo-600" @click="startEdit(m)">
                {{ m.full_name }}
              </button>
            </td>
            <td class="px-4 py-2.5">
              <span class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">{{ roleName(m.role_id) }}</span>
            </td>
            <td class="px-4 py-2.5">
              <label class="flex items-center gap-2 text-gray-600">
                <input type="checkbox" :checked="m.online_booking_enabled" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleBookable(m)" />
                Bookable
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="invites.length > 0" class="mt-4">
      <h2 class="text-sm font-semibold text-gray-900">Pending invites</h2>
      <ul class="mt-2 space-y-2">
        <li v-for="inv in invites" :key="inv.id" class="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
          <span class="text-gray-700">{{ inv.email || 'Any email' }} &middot; {{ roleName(inv.role_id) }}</span>
          <div class="flex gap-3">
            <button type="button" class="text-indigo-600 hover:text-indigo-500" @click="copy(inviteLink(inv.token))">Copy link</button>
            <button type="button" class="text-red-600 hover:text-red-500" @click="revokeInvite(inv.id)">Revoke</button>
          </div>
        </li>
      </ul>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="createInvite">
      <div>
        <label class="block text-sm font-medium text-gray-700">Email</label>
        <input v-model="inviteEmail" type="email" required placeholder="colleague@example.com" class="mt-1 w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Role</label>
        <select v-model="inviteRoleId" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <button type="submit" :disabled="inviting" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ inviting ? 'Creating…' : 'Create Invite Link' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="emailStatus === 'sent'" class="mt-2 text-sm text-green-700">Invite email sent ✓</p>
    <p v-if="emailStatus === 'failed'" class="mt-2 text-sm text-amber-700">Couldn't send the invite email — share the link below instead.</p>
    <div v-if="lastInviteLink" class="mt-2 rounded-md bg-green-50 p-3 text-sm text-green-800">
      Share this link (e.g. via WhatsApp): <span class="break-all font-medium">{{ lastInviteLink }}</span>
      <button type="button" class="ml-2 font-medium underline" @click="copy(lastInviteLink)">Copy</button>
    </div>
    </div>
  </div>
</template>
