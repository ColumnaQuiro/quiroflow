<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const store = useAccountStore()
const { preference: themePreference, setPreference: setThemePreference } = useTheme()
const { preference: langPreference, setPreference: setLangPreference } = useLang()
const t = useT()

const { showToast } = useToast()

const themeOptions = computed(() => [
  { value: 'light' as const, label: t('Light', 'Claro'), description: t('Always use the light theme.', 'Usar siempre el tema claro.') },
  { value: 'dark' as const, label: t('Dark', 'Oscuro'), description: t('Always use the dark theme.', 'Usar siempre el tema oscuro.') },
  { value: 'system' as const, label: t('System', 'Sistema'), description: t("Match this device's own light/dark setting.", 'Igualar el ajuste claro/oscuro de este dispositivo.') },
])
const languageOptions = [
  { value: 'en' as const, label: 'English', description: 'Show QuiroFlow in English.' },
  { value: 'es' as const, label: 'Español', description: 'Mostrar QuiroFlow en español.' },
]

const savingTheme = ref(false)
const savingLang = ref(false)

async function chooseTheme(value: 'light' | 'dark' | 'system') {
  setThemePreference(value)
  savingTheme.value = true
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', store.teamMember!.id)
  if (store.teamMember) store.teamMember.theme_preference = value
  savingTheme.value = false
}

async function chooseLanguage(value: 'en' | 'es') {
  setLangPreference(value)
  savingLang.value = true
  await supabase.from('team_members').update({ language_preference: value }).eq('id', store.teamMember!.id)
  if (store.teamMember) store.teamMember.language_preference = value
  savingLang.value = false
}

const fullName = ref('')
const color = ref('#4C6FEB')
const savingProfile = ref(false)

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
  savingProfile.value = true
  const { error } = await supabase
    .from('team_members')
    .update({ full_name: fullName.value.trim(), color: color.value })
    .eq('id', store.teamMember.id)
  savingProfile.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  store.teamMember.full_name = fullName.value.trim()
  store.teamMember.color = color.value
  showToast('Saved')
}

const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)

async function changePassword() {
  if (newPassword.value.length < 8) {
    showToast(t('Password must be at least 8 characters.', 'La contraseña debe tener al menos 8 caracteres.'), 'error')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast(t('Passwords do not match.', 'Las contraseñas no coinciden.'), 'error')
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  savingPassword.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  newPassword.value = ''
  confirmPassword.value = ''
  showToast('Password updated.')
}

const deletingAccount = ref(false)
async function deleteAccount() {
  if (!confirm("Delete your account? This signs you out and revokes your login immediately. This can't be undone by you -- an owner would need to re-invite you to come back.")) return
  deletingAccount.value = true
  try {
    await $fetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    showToast(err?.data?.statusMessage ?? 'Failed to delete account.', 'error')
    return
  }
  await supabase.auth.signOut()
  await navigateTo('/login')
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
      <div v-if="store.teamMember" class="flex items-center gap-3">
        <SettingsTeamMemberPhotoUpload
          :account-id="store.accountId!"
          :team-member-id="store.teamMember.id"
          :photo-storage-path="store.teamMember.photo_storage_path"
          :initials="fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'"
          :color="color"
          :size="56"
          @uploaded="store.load()"
        />
        <p class="text-[12.5px] text-ink-muted">{{ t('Click to change your photo. Shown in the sidebar, and on online booking if you take appointments.', 'Haz clic para cambiar tu foto. Se muestra en la barra lateral y en la reserva online si atiendes citas.') }}</p>
      </div>
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
      </div>
    </form>

    <div class="mt-6 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 class="text-sm font-semibold text-ink-900">{{ t('Appearance', 'Apariencia') }}</h2>
      <p class="text-[12.5px] text-ink-muted2">{{ t("This is your own preference -- it doesn't affect what anyone else on your team sees.", 'Esta es tu propia preferencia -- no afecta lo que ve el resto de tu equipo.') }}</p>

      <div class="space-y-2">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          class="flex w-full items-center justify-between rounded-ctl border p-3 text-left"
          :class="themePreference === opt.value ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'"
          :disabled="savingTheme"
          @click="chooseTheme(opt.value)"
        >
          <div>
            <p class="text-[13px] font-medium text-ink-900">{{ opt.label }}</p>
            <p class="mt-0.5 text-[12px] text-ink-muted2">{{ opt.description }}</p>
          </div>
          <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" :class="themePreference === opt.value ? 'border-brand bg-brand' : 'border-line-control'">
            <span v-if="themePreference === opt.value" class="h-2 w-2 rounded-full bg-white" />
          </div>
        </button>
      </div>

      <p class="pt-2 text-[13px] font-[560] text-ink-700">{{ t('Language', 'Idioma') }}</p>

      <div class="space-y-2">
        <button
          v-for="opt in languageOptions"
          :key="opt.value"
          type="button"
          class="flex w-full items-center justify-between rounded-ctl border p-3 text-left"
          :class="langPreference === opt.value ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'"
          :disabled="savingLang"
          @click="chooseLanguage(opt.value)"
        >
          <div>
            <p class="text-[13px] font-medium text-ink-900">{{ opt.label }}</p>
            <p class="mt-0.5 text-[12px] text-ink-muted2">{{ opt.description }}</p>
          </div>
          <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" :class="langPreference === opt.value ? 'border-brand bg-brand' : 'border-line-control'">
            <span v-if="langPreference === opt.value" class="h-2 w-2 rounded-full bg-white" />
          </div>
        </button>
      </div>
    </div>

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
      </div>
    </form>

    <div class="mt-6 space-y-3 rounded-card border border-danger-border bg-danger-bg p-4">
      <h2 class="text-sm font-semibold text-danger-text">Delete Account</h2>
      <p class="text-sm text-ink-muted">
        Removes your login from this clinic immediately. Your name stays attached to past appointments and records for
        the clinic's own history -- it isn't erased, just your access to it.
      </p>
      <UiBtn type="button" variant="secondary" class="border-danger-border text-danger-text" :disabled="deletingAccount" @click="deleteAccount">
        {{ deletingAccount ? 'Deleting…' : 'Delete Account' }}
      </UiBtn>
    </div>
    </div>
    </div>
  </div>
</template>
