<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const members = ref<Tables<'team_members'>[]>([])
const invites = ref<Tables<'account_invites'>[]>([])
const loading = ref(true)

const inviteEmail = ref('')
const inviteRole = ref<'owner' | 'practitioner' | 'front_desk'>('practitioner')
const inviting = ref(false)
const error = ref('')
const lastInviteLink = ref('')

async function load() {
  loading.value = true
  const [{ data: m }, { data: i }] = await Promise.all([
    supabase.from('team_members').select('*').order('full_name'),
    supabase.from('account_invites').select('*').is('accepted_at', null).order('created_at', { ascending: false }),
  ])
  members.value = m ?? []
  invites.value = i ?? []
  loading.value = false
}
onMounted(load)

async function createInvite() {
  error.value = ''
  lastInviteLink.value = ''
  inviting.value = true
  const { data, error: insertError } = await supabase
    .from('account_invites')
    .insert({
      account_id: store.accountId!,
      email: inviteEmail.value.trim() || null,
      role: inviteRole.value,
    })
    .select('token')
    .single()

  inviting.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  lastInviteLink.value = `${window.location.origin}/join?token=${data.token}`
  inviteEmail.value = ''
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

const roleClass: Record<string, string> = {
  owner: 'bg-indigo-50 text-indigo-700',
  practitioner: 'bg-green-50 text-green-700',
  front_desk: 'bg-gray-100 text-gray-600',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Team Members</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>

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
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="roleClass[m.role]">{{ m.role }}</span>
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
          <span class="text-gray-700">{{ inv.email || 'Any email' }} &middot; {{ inv.role }}</span>
          <div class="flex gap-3">
            <button type="button" class="text-indigo-600 hover:text-indigo-500" @click="copy(inviteLink(inv.token))">Copy link</button>
            <button type="button" class="text-red-600 hover:text-red-500" @click="revokeInvite(inv.id)">Revoke</button>
          </div>
        </li>
      </ul>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="createInvite">
      <div>
        <label class="block text-sm font-medium text-gray-700">Email (optional)</label>
        <input v-model="inviteEmail" type="email" placeholder="colleague@example.com" class="mt-1 w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Role</label>
        <select v-model="inviteRole" class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="practitioner">Practitioner</option>
          <option value="front_desk">Front desk</option>
          <option value="owner">Owner</option>
        </select>
      </div>
      <button type="submit" :disabled="inviting" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ inviting ? 'Creating…' : 'Create Invite Link' }}
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    <div v-if="lastInviteLink" class="mt-2 rounded-md bg-green-50 p-3 text-sm text-green-800">
      Share this link (e.g. via WhatsApp): <span class="break-all font-medium">{{ lastInviteLink }}</span>
      <button type="button" class="ml-2 font-medium underline" @click="copy(lastInviteLink)">Copy</button>
    </div>
  </div>
</template>
