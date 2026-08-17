import { defineStore } from 'pinia'

export interface TeamMember {
  id: string
  account_id: string
  full_name: string
  role: 'owner' | 'practitioner' | 'front_desk'
  color: string
}

export interface Clinic {
  id: string
  account_id: string
  name: string
  address: string | null
}

export const useAccountStore = defineStore('account', {
  state: () => ({
    teamMember: null as TeamMember | null,
    accountName: '' as string,
    accountSlug: '' as string,
    clinics: [] as Clinic[],
    currentClinicId: null as string | null,
    loaded: false,
    loading: false,
  }),
  getters: {
    accountId: (state) => state.teamMember?.account_id ?? null,
    currentClinic: (state) => state.clinics.find((c) => c.id === state.currentClinicId) ?? null,
  },
  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      const supabase = useSupabaseClient()

      const { data: teamMember } = await supabase
        .from('team_members')
        .select('id, account_id, full_name, role, color')
        .maybeSingle()

      if (!teamMember) {
        this.teamMember = null
        this.loaded = true
        this.loading = false
        return
      }

      this.teamMember = teamMember as TeamMember

      const [{ data: account }, { data: clinics }] = await Promise.all([
        supabase.from('accounts').select('name, slug').eq('id', teamMember.account_id).maybeSingle(),
        supabase.from('clinics').select('id, account_id, name, address').eq('account_id', teamMember.account_id),
      ])

      this.accountName = account?.name ?? ''
      this.accountSlug = account?.slug ?? ''
      this.clinics = (clinics as Clinic[]) ?? []
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
      this.clinics = []
      this.currentClinicId = null
      this.loaded = false
      this.loading = false
    },
  },
})
