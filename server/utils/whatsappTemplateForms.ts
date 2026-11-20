// Which QuiroFlow form a WhatsApp template's form button opens
// (whatsapp_template_forms). Meta keeps only the button's link, `<app>/doc/{{1}}`;
// the form is chosen once in the template creator and read back here by every
// send that fills the button -- automation steps and hand-sent templates alike.
//
// Every function takes the service-role client: the table is written only
// from the template endpoints, after their permission guard.

const key = (name: string, language: string) => `${name}.${language}`

/** Every template of this clinic that opens a form, keyed `name.language`. */
export async function templateForms(supabase: any, accountId: string): Promise<Map<string, string>> {
  const { data } = await supabase.from('whatsapp_template_forms').select('template_name, template_language, doc_template_id').eq('account_id', accountId)
  return new Map((data ?? []).map((r: any) => [key(r.template_name, r.template_language), r.doc_template_id as string]))
}

/** The form one template's button opens, or null when it has none (or its form was deleted). */
export async function templateForm(supabase: any, accountId: string, name: string, language: string): Promise<string | null> {
  const { data } = await supabase
    .from('whatsapp_template_forms')
    .select('doc_template_id')
    .eq('account_id', accountId)
    .eq('template_name', name)
    .eq('template_language', language)
    .maybeSingle()
  return data?.doc_template_id ?? null
}

/**
 * Whether this form is one of the clinic's own, original forms -- the id
 * comes from the browser, and a button must never open another clinic's form.
 * A legacy translation row (translation_of set) is not offered either: the
 * send picks the patient's language from the original.
 */
export async function isOwnForm(supabase: any, accountId: string, docTemplateId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(docTemplateId)) return false
  const { data } = await supabase.from('doc_templates').select('id').eq('id', docTemplateId).eq('account_id', accountId).is('translation_of', null).maybeSingle()
  return !!data
}

/** Records the form a template's button opens, or forgets it when the template no longer has one. */
export async function saveTemplateForm(supabase: any, accountId: string, name: string, language: string, docTemplateId: string | null): Promise<void> {
  if (!docTemplateId) {
    await supabase.from('whatsapp_template_forms').delete().eq('account_id', accountId).eq('template_name', name).eq('template_language', language)
    return
  }
  const { error } = await supabase
    .from('whatsapp_template_forms')
    .upsert({ account_id: accountId, template_name: name, template_language: language, doc_template_id: docTemplateId }, { onConflict: 'account_id,template_name,template_language' })
  if (error) throw new Error(`Could not keep which form the button opens: ${error.message}`)
}
