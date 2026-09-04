import { defineStore } from 'pinia'

export interface TeamMember {
  id: string
  account_id: string
  full_name: string
  role: 'owner' | 'practitioner' | 'front_desk'
  color: string
  is_owner: boolean
  theme_preference: 'light' | 'dark' | 'system'
  language_preference: 'en' | 'es'
  photo_storage_path: string | null
}

export type PermissionValue = boolean | 'all' | 'own' | 'none'

// Same localStorage convention as useTheme/useLang -- remembers which
// clinic a team member was last looking at across reloads. Scoped to
// whatever ends up in this.clinics (account-scoped) before being trusted,
// so a stale id from a previous account/browser profile can't leak in.
const CURRENT_CLINIC_STORAGE_KEY = 'quiroflow-current-clinic-id'

export interface Clinic {
  id: string
  account_id: string
  name: string
  address: string | null
  slot_duration_minutes: number
  business_hours: Record<string, [string, string][]> | null
  legal_name: string | null
  tax_id: string | null
  invoice_footer_text: string | null
  logo_storage_path: string | null
}

export const useAccountStore = defineStore('account', {
  state: () => ({
    teamMember: null as TeamMember | null,
    accountName: '' as string,
    accountSlug: '' as string,
    whatsappConfirmationTemplateName: '' as string,
    whatsappRecallTemplateName: '' as string,
    schedulingPolicyFeeCents: null as number | null,
    clinics: [] as Clinic[],
    currentClinicId: null as string | null,
    permissions: {} as Record<string, PermissionValue>,
    subscriptionStatus: null as string | null,
    trialEndsAt: null as string | null,
    loaded: false,
    loading: false,
  }),
  getters: {
    accountId: (state) => state.teamMember?.account_id ?? null,
    currentClinic: (state) => state.clinics.find((c) => c.id === state.currentClinicId) ?? null,
    isOwner: (state) => state.teamMember?.is_owner ?? false,
    // No row at all (shouldn't happen post-backfill, but a store reload
    // mid-migration is possible) fails open, same as requireActiveAccount.
    isBillingLocked: (state) => state.subscriptionStatus === 'locked' || state.subscriptionStatus === 'canceled',
    // Only meaningful while still trialing -- null once on a real plan (no
    // trial_ends_at) or already past it (negative), so the banner can just
    // check `!== null`.
    trialDaysLeft: (state) => {
      if (state.subscriptionStatus !== 'trialing' || !state.trialEndsAt) return null
      return Math.max(0, Math.ceil((new Date(state.trialEndsAt).getTime() - Date.now()) / 86400000))
    },
  },
  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      const supabase = useSupabaseClient()
      const user = useSupabaseUser()

      if (!user.value) {
        this.teamMember = null
        this.loaded = true
        this.loading = false
        return
      }

      // One round-trip, not two. This used to fetch team_members, and only
      // once that resolved (it carries the account_id everything else keys
      // off) fetch account/clinics/permissions/subscription. Because
      // middleware/account.global.ts blocks navigation on this, that second
      // hop delayed *everything* -- page queries, sidebar badges, the
      // Billing tab all sat idle until it finished, then started at once.
      // get_my_bootstrap resolves the team member from auth.uid() server-side
      // and returns all five together.
      const { data: boot } = await supabase.rpc('get_my_bootstrap')
      const bootstrap = (boot ?? {}) as unknown as {
        team_member: TeamMember | null
        account: { name: string; slug: string; whatsapp_confirmation_template_name: string | null; whatsapp_recall_template_name: string | null; scheduling_policy_fee_cents: number | null } | null
        clinics: Clinic[]
        permissions: Record<string, PermissionValue>
        subscription: { status: string; trial_ends_at: string | null } | null
      }
      const teamMember = bootstrap.team_member

      if (!teamMember) {
        this.teamMember = null
        this.loaded = true
        this.loading = false
        return
      }

      this.teamMember = teamMember
      // The client plugin already applied whatever was cached in
      // localStorage before this resolved -- this reconciles it with the
      // user's real saved preference (e.g. first login on a new device).
      useTheme().setPreference(teamMember.theme_preference as 'light' | 'dark' | 'system')
      useLang().setPreference(teamMember.language_preference as 'en' | 'es')

      const account = bootstrap.account
      const clinics = bootstrap.clinics
      const permissions = bootstrap.permissions
      const subscription = bootstrap.subscription

      this.accountName = account?.name ?? ''
      this.accountSlug = account?.slug ?? ''
      this.whatsappConfirmationTemplateName = account?.whatsapp_confirmation_template_name ?? ''
      this.whatsappRecallTemplateName = account?.whatsapp_recall_template_name ?? ''
      this.schedulingPolicyFeeCents = account?.scheduling_policy_fee_cents ?? null
      this.clinics = (clinics as Clinic[]) ?? []
      this.permissions = (permissions as Record<string, PermissionValue>) ?? {}
      this.subscriptionStatus = subscription?.status ?? null
      this.trialEndsAt = subscription?.trial_ends_at ?? null
      if (!this.currentClinicId && this.clinics.length > 0) {
        const stored = import.meta.server ? null : localStorage.getItem(CURRENT_CLINIC_STORAGE_KEY)
        this.currentClinicId = (stored && this.clinics.some((c) => c.id === stored)) ? stored : this.clinics[0].id
      }

      this.loaded = true
      this.loading = false
    },
    // The only place currentClinicId should be written to after initial
    // load -- routes through here (not a direct state.currentClinicId =
    // assignment) so the switcher's choice also persists to localStorage.
    setCurrentClinic(id: string) {
      this.currentClinicId = id
      if (!import.meta.server) localStorage.setItem(CURRENT_CLINIC_STORAGE_KEY, id)
    },
    reset() {
      this.teamMember = null
      this.accountName = ''
      this.accountSlug = ''
      this.whatsappConfirmationTemplateName = ''
      this.whatsappRecallTemplateName = ''
      this.schedulingPolicyFeeCents = null
      this.clinics = []
      this.currentClinicId = null
      this.permissions = {}
      this.subscriptionStatus = null
      this.trialEndsAt = null
      this.loaded = false
      this.loading = false
    },
  },
})
