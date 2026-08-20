<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const store = useAccountStore()

const fullName = ref('')
const color = ref('#4C6FEB')
const savingProfile = ref(false)
const profileSaved = ref(false)
const profileError = ref('')

watch(
  () => store.teamMember,
  (tm) => {
    if (tm) {
      fullName.value = tm.full_name
      color.value = tm.color
    }
  },
  { immediate: true },
)

async function saveProfile() {
  if (!store.teamMember) return
  profileError.value = ''
  profileSaved.value = false
  savingProfile.value = true
  const { error } = await supabase
    .from('team_members')
    .update({ full_name: fullName.value.trim(), color: color.value })
    .eq('id', store.teamMember.id)
  savingProfile.value = false
  if (error) {
    profileError.value = error.message
    return
  }
  store.teamMember.full_name = fullName.value.trim()
  store.teamMember.color = color.value
  profileSaved.value = true
}

const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordSaved = ref(false)
const passwordError = ref('')

async function changePassword() {
  passwordError.value = ''
  passwordSaved.value = false
  if (newPassword.value.length < 8) {
    passwordError.value = 'Password must be at least 8 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match.'
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  savingPassword.value = false
  if (error) {
    passwordError.value = error.message
    return
  }
  newPassword.value = ''
  confirmPassword.value = ''
  passwordSaved.value = true
}
</script>

<template>
  <div class="max-w-lg">
    <h1 class="text-xl font-semibold text-gray-900">Account Settings</h1>
    <p class="mt-1 text-sm text-gray-500">Your personal details and login.</p>

    <form class="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="saveProfile">
      <h2 class="text-sm font-semibold text-gray-900">Personal Details</h2>
      <div>
        <label class="block text-sm font-medium text-gray-700">Full Name</label>
        <input v-model="fullName" type="text" required class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Email</label>
        <input :value="user?.email" type="email" disabled class="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Calendar Color</label>
        <input v-model="color" type="color" class="mt-1 h-9 w-14 rounded-md border border-gray-300" />
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="savingProfile" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ savingProfile ? 'Saving…' : 'Save' }}
        </button>
        <p v-if="profileSaved" class="text-sm text-green-600">Saved.</p>
        <p v-if="profileError" class="text-sm text-red-600">{{ profileError }}</p>
      </div>
    </form>

    <form class="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="changePassword">
      <h2 class="text-sm font-semibold text-gray-900">Change Password</h2>
      <div>
        <label class="block text-sm font-medium text-gray-700">New Password</label>
        <input v-model="newPassword" type="password" required minlength="8" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Confirm New Password</label>
        <input v-model="confirmPassword" type="password" required minlength="8" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="savingPassword" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ savingPassword ? 'Saving…' : 'Update Password' }}
        </button>
        <p v-if="passwordSaved" class="text-sm text-green-600">Password updated.</p>
        <p v-if="passwordError" class="text-sm text-red-600">{{ passwordError }}</p>
      </div>
    </form>
  </div>
</template>
