// The app's stand-in for the web's account store (stores/account.ts), which
// this bundle cannot use: it does not register Pinia (see
// usePractitionerContext.ts). Shared staff components read a handful of the
// store's fields -- who is signed in, for created_by/updated_by; the account;
// whether they are an owner; the clinic open on this device -- and those are
// answered here from the practitioner context, so the web's components work
// unchanged in the app (Personal: contracts, documents, absences, pay plans).
//
// Only the fields below exist. A shared component that reads any other field
// gets undefined here, so before rendering a new one in the app, check what
// it reads (grep "store\." in it and its children) and add the field.
export function useAccountStore() {
  const { context } = usePractitionerContext()
  return reactive({
    accountId: computed(() => context.value?.accountId ?? null),
    teamMember: computed(() => (context.value ? { id: context.value.teamMemberId, full_name: context.value.fullName } : null)),
    isOwner: computed(() => context.value?.isOwner ?? false),
    currentClinicId: computed(() => context.value?.clinicId ?? null),
    hasStaffSection: computed(() => context.value?.hasStaffSection ?? false),
  })
}
