<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const store = useAccountStore()
const t = useT()

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
    passwordError.value = t('Password must be at least 8 characters.', 'La contraseña debe tener al menos 8 caracteres.')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = t('Passwords do not match.', 'Las contraseñas no coinciden.')
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
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Account Settings', 'Ajustes de la Cuenta')" />
    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
    <div class="max-w-lg">
    <p class="text-sm text-ink-muted">{{ t('Your personal details and login.', 'Tus datos personales y de acceso.') }}</p>

    <form class="mt-6 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="saveProfile">
      <h2 class="text-sm font-semibold text-ink-900">{{ t('Personal Details', 'Datos Personales') }}</h2>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Full Name', 'Nombre Completo') }}</label>
        <input v-model="fullName" type="text" required class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Email', 'Correo Electrónico') }}</label>
        <input :value="user?.email" type="email" disabled class="mt-1 w-full rounded-ctl border border-line bg-surface-subtle px-3 py-1.5 text-sm text-ink-muted" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Calendar Color', 'Color del Calendario') }}</label>
        <input v-model="color" type="color" class="mt-1 h-9 w-14 rounded-ctl border border-line-control" />
      </div>
      <div class="flex items-center gap-3">
        <UiBtn type="submit" variant="primary" :disabled="savingProfile">
          {{ savingProfile ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
        </UiBtn>
        <p v-if="profileSaved" class="text-sm text-success-text">{{ t('Saved.', 'Guardado.') }}</p>
        <p v-if="profileError" class="text-sm text-danger-text">{{ profileError }}</p>
      </div>
    </form>

    <form class="mt-6 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="changePassword">
      <h2 class="text-sm font-semibold text-ink-900">{{ t('Change Password', 'Cambiar Contraseña') }}</h2>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('New Password', 'Nueva Contraseña') }}</label>
        <input v-model="newPassword" type="password" required minlength="8" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Confirm New Password', 'Confirmar Nueva Contraseña') }}</label>
        <input v-model="confirmPassword" type="password" required minlength="8" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div class="flex items-center gap-3">
        <UiBtn type="submit" variant="primary" :disabled="savingPassword">
          {{ savingPassword ? t('Saving…', 'Guardando…') : t('Update Password', 'Actualizar Contraseña') }}
        </UiBtn>
        <p v-if="passwordSaved" class="text-sm text-success-text">{{ t('Password updated.', 'Contraseña actualizada.') }}</p>
        <p v-if="passwordError" class="text-sm text-danger-text">{{ passwordError }}</p>
      </div>
    </form>
    </div>
    </div>
  </div>
</template>
