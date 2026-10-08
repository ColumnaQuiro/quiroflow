<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const supabase = useSupabaseClient()
const t = useT()
const { context, loading, clinics, setClinic } = usePractitionerContext()
const { unregister: unregisterPush } = usePushNotifications()
const { ask, notify } = useAppConfirm()
const authedFetch = useAuthedFetch()

async function signOut() {
  await unregisterPush()
  clearVisitNoteDrafts()
  // This device only. The default, scope 'global', also signed the person
  // out of every other phone and browser; the web's Account page keeps a
  // separate "sign out of other devices".
  await supabase.auth.signOut({ scope: 'local' })
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/login')
}

const photoError = ref('')
async function onPhotoUploaded() {
  photoError.value = ''
  if (!context.value) return
  const { data } = await supabase.from('team_members').select('photo_storage_path').eq('id', context.value.teamMemberId).maybeSingle()
  if (data) context.value.photoStoragePath = data.photo_storage_path
}

const deletingAccount = ref(false)
async function deleteAccount() {
  const ok = await ask({
    title: t('Delete your account?', '¿Eliminar tu cuenta?'),
    body: t(
        "This signs you out and revokes your login immediately. This can't be undone by you — an owner would need to re-invite you to come back.",
        'Se cerrará tu sesión y se revocará tu acceso de inmediato. No podrás deshacerlo tú: un propietario tendría que volver a invitarte.',
    ),
    confirmLabel: t('Delete account', 'Eliminar cuenta'),
    cancelLabel: t('Cancel', 'Cancelar'),
    danger: true,
  })
  if (!ok) return
  deletingAccount.value = true
  try {
    await authedFetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    notify(err?.data?.statusMessage ?? t('Failed to delete account.', 'No se pudo eliminar la cuenta.'))
    return
  }
  await unregisterPush()
  clearVisitNoteDrafts()
  await supabase.auth.signOut({ scope: 'local' })
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppPageHeader :title="t('Profile', 'Perfil')" />

    <AppSkeletonList v-if="loading" :rows="4" class="flex-1" />

    <div v-else class="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
      <div v-if="context" class="flex items-center gap-3">
        <SettingsTeamMemberPhotoUpload
          :account-id="context.accountId"
          :team-member-id="context.teamMemberId"
          :photo-storage-path="context.photoStoragePath"
          :initials="(context.fullName ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('') || '?'"
          :size="56"
          @uploaded="onPhotoUploaded"
          @failed="(m: string) => (photoError = m)"
        />
        <div class="min-w-0">
          <p class="truncate text-[17px] font-semibold text-ink-900">{{ context?.fullName }}</p>
          <p class="text-[12.5px] text-ink-muted2">{{ context?.isOwner ? t('Owner', 'Propietario') : t('Team member', 'Miembro del equipo') }}</p>
        </div>
      </div>
      <p v-if="photoError" class="text-[13px] font-semibold text-danger-text">{{ t('Could not change your photo:', 'No se ha podido cambiar tu foto:') }} {{ photoError }}</p>

      <!-- Which location the app works in, when the account has more than one -->
      <div v-if="context && clinics.length > 1" class="rounded-card border border-line bg-surface shadow-card px-4 py-3.5" data-cy="clinic-switcher">
        <p class="text-[13.5px] font-medium text-ink-900">{{ t('Clinic', 'Clínica') }}</p>
        <p class="mt-0.5 text-[12px] text-ink-muted">{{ t('My Day, the calendar and new visits use this location.', 'Mi día, la agenda y las citas nuevas usan esta clínica.') }}</p>
        <div role="radiogroup" :aria-label="t('Clinic', 'Clínica')" class="mt-2.5 flex flex-col gap-1.5">
          <button
            v-for="c in clinics"
            :key="c.id"
            type="button"
            role="radio"
            :aria-checked="context.clinicId === c.id"
            class="flex min-h-11 items-center justify-between rounded-ctl px-3.5 text-left text-[14px]"
            :class="context.clinicId === c.id ? 'border-[1.5px] border-brand bg-brand-tint font-semibold text-ink-900' : 'border border-line-control text-ink-700'"
            @click="setClinic(c.id)"
          >
            {{ c.name }}
          </button>
        </div>
      </div>
      <StaffPushSettings v-if="context" />
      <StaffSecuritySettings v-if="context" :account-id="context.accountId" />
      <LanguageSetting />
      <ThemeSetting />

      <button
        type="button"
        class="w-full rounded-ctl border border-line-control px-4 py-2.5 text-center text-[14px] font-medium text-danger-text active:bg-surface-subtle"
        @click="signOut"
      >
        {{ t('Sign out', 'Cerrar sesión') }}
      </button>

      <div class="mt-2 space-y-2 rounded-ctl border border-danger-border bg-danger-bg p-3">
        <p class="text-[12.5px] text-ink-muted">
          {{
            t(
              "Deleting your account removes your login from this clinic immediately. Your name stays on past appointments for the clinic's own records — it isn't erased, just your access.",
              'Eliminar tu cuenta quita tu acceso a esta clínica de inmediato. Tu nombre se mantiene en las citas pasadas para los registros de la clínica: no se borra, solo tu acceso.',
            )
          }}
        </p>
        <button
          type="button"
          class="w-full rounded-ctl border border-danger-border px-4 py-2.5 text-center text-[14px] font-medium text-danger-text active:bg-danger-bg2"
          :disabled="deletingAccount"
          @click="deleteAccount"
        >
          {{ deletingAccount ? t('Deleting…', 'Eliminando…') : t('Delete account', 'Eliminar cuenta') }}
        </button>
      </div>
    </div>
  </div>
</template>
