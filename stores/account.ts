import { defineStore } from 'pinia'

export interface TeamMember {
  id: string
  account_id: string
  full_name: string
  role: 'owner' | 'practitioner' | 'front_desk'
  color: string
  is_owner: boolean
}

export type PermissionValue = boolean | 'all' | 'own' | 'none'

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
    clinics: [] as Clinic[],
    currentClinicId: null as string | null,
    permissions: {} as Record<string, PermissionValue>,
    loaded: false,
    loading: false,
  }),
  getters: {
    accountId: (state) => state.teamMember?.account_id ?? null,
    currentClinic: (state) => state.clinics.find((c) => c.id === state.currentClinicId) ?? null,
    isOwner: (state) => state.teamMember?.is_owner ?? false,
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

      const { data: teamMember } = await supabase
        .from('team_members')
        .select('id, account_id, full_name, role, color, is_owner')
        .eq('user_id', user.value.sub)
        .maybeSingle()

      if (!teamMember) {
        this.teamMember = null
        this.loaded = true
        this.loading = false
        return
      }

      this.teamMember = teamMember as TeamMember

      const [{ data: account }, { data: clinics }, { data: permissions }] = await Promise.all([
        supabase
          .from('accounts')
          .select('name, slug, whatsapp_confirmation_template_name, whatsapp_recall_template_name')
          .eq('id', teamMember.account_id)
          .maybeSingle(),
        supabase
          .from('clinics')
          .select('id, account_id, name, address, slot_duration_minutes, business_hours, legal_name, tax_id, invoice_footer_text, logo_storage_path')
          .eq('account_id', teamMember.account_id),
        supabase.rpc('get_my_permissions', { target_account_id: teamMember.account_id }),
      ])

      this.accountName = account?.name ?? ''
      this.accountSlug = account?.slug ?? ''
      this.whatsappConfirmationTemplateName = account?.whatsapp_confirmation_template_name ?? ''
      this.whatsappRecallTemplateName = account?.whatsapp_recall_template_name ?? ''
      this.clinics = (clinics as Clinic[]) ?? []
      this.permissions = (permissions as Record<string, PermissionValue>) ?? {}
      if (!this.currentClinicId && this.clinics.length > 0) {
        this.currentClinicId = this.clinics[0].id
      }

      this.loaded = true
      this.loading = false
    },
    reset() {
      this.teamMember = null
      this.accountName = ''
      this.accountSlug = ''
      this.whatsappConfirmationTemplateName = ''
      this.whatsappRecallTemplateName = ''
      this.clinics = []
      this.currentClinicId = null
      this.permissions = {}
      this.loaded = false
      this.loading = false
    },
  },
})
