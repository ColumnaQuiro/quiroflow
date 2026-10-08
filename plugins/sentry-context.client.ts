import * as Sentry from '@sentry/nuxt'

// Which clinic and which team member an error happened to, so there is
// someone to ask. Ids only: a name or an email would be personal data sent
// to a third party for no gain, and the ids are enough to look them up.
export default defineNuxtPlugin(() => {
  if (!useRuntimeConfig().public.sentryDsn) return
  const store = useAccountStore()
  watch(
    () => [store.accountId, store.teamMember?.id] as const,
    ([accountId, teamMemberId]) => {
      Sentry.setTag('account_id', accountId ?? null)
      Sentry.setUser(teamMemberId ? { id: teamMemberId } : null)
    },
    { immediate: true },
  )
})
