import { asEmailDesign, type EmailDesign } from '~/utils/emailDesign'

// The clinic's saved email templates (email_templates,
// 20261105161255_email_templates.sql). Read by every member; written by anyone
// whose role has communication_config, as automations are -- RLS decides,
// and a refusal comes back as the error it is rather than as an empty list.

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  design: EmailDesign
  updated_at: string
}

export function useEmailTemplates() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const templates = ref<EmailTemplate[]>([])
  const loaded = ref(false)
  const error = ref('')

  async function load() {
    error.value = ''
    const { data, error: err } = await supabase
      .from('email_templates')
      .select('id, name, subject, design, updated_at')
      .eq('account_id', store.accountId!)
      .order('updated_at', { ascending: false })
    if (err) error.value = err.message
    // A row whose design no longer reads is left out rather than offered half-built.
    templates.value = (data ?? []).flatMap((r) => {
      const design = asEmailDesign(r.design)
      return design ? [{ ...r, design }] : []
    })
    loaded.value = true
  }

  async function save(input: { name: string; subject: string; design: EmailDesign }, replaceId?: string | null) {
    const row = { name: input.name.trim(), subject: input.subject, design: JSON.parse(JSON.stringify(input.design)), updated_at: new Date().toISOString() }
    const { error: err } = replaceId
      ? await supabase.from('email_templates').update(row).eq('id', replaceId)
      : await supabase.from('email_templates').insert({ ...row, account_id: store.accountId!, created_by: store.teamMember?.id ?? null })
    if (err) return err.message
    await load()
    return null
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from('email_templates').delete().eq('id', id)
    if (err) return err.message
    templates.value = templates.value.filter((x) => x.id !== id)
    return null
  }

  return { templates, loaded, error, load, save, remove }
}
