// What every template send fills that the sender did not: the heading's {{1}},
// the file or place at the top, a link's {{1}}, a code to copy, a quick
// reply's payload (utils/whatsappTemplateSend.ts says how). This is the part
// that reads the database: what QuiroFlow kept for the template when it was
// made (whatsapp_template_send_values) and the file it was made with.
//
// Every function takes the service-role client: the table is written only
// from the template endpoints, after their permission guard, and the file
// sits in the private whatsapp-media bucket.

import type { TemplateSendValues } from '~/utils/whatsappTemplateDraft'
import { completeTemplateComponents, templateMediaFormat, type MetaTemplateDefinition, type SendComponent, type TemplateSendInputs } from '~/utils/whatsappTemplateSend'
import { templateMediaFile } from '~/server/utils/whatsappTemplateMedia'

const key = (name: string, language: string) => `${name}.${language}`

/** Every template of this clinic that QuiroFlow fills, keyed `name.language`. */
export async function allTemplateSendValues(supabase: any, accountId: string): Promise<Map<string, TemplateSendValues>> {
  const { data } = await supabase.from('whatsapp_template_send_values').select('template_name, template_language, send_values').eq('account_id', accountId)
  return new Map((data ?? []).map((r: any) => [key(r.template_name, r.template_language), r.send_values as TemplateSendValues]))
}

/** What QuiroFlow fills one template with, or null when it was not made here (or needs nothing). */
export async function templateSendValues(supabase: any, accountId: string, name: string, language: string): Promise<TemplateSendValues | null> {
  const { data } = await supabase
    .from('whatsapp_template_send_values')
    .select('send_values')
    .eq('account_id', accountId)
    .eq('template_name', name)
    .eq('template_language', language)
    .maybeSingle()
  return (data?.send_values as TemplateSendValues | undefined) ?? null
}

/** Keeps what the template is filled with, or forgets it when it needs nothing -- so a name reused later starts clean. */
export async function saveTemplateSendValues(supabase: any, accountId: string, name: string, language: string, values: TemplateSendValues | null): Promise<void> {
  if (!values) {
    await supabase.from('whatsapp_template_send_values').delete().eq('account_id', accountId).eq('template_name', name).eq('template_language', language)
    return
  }
  const { error } = await supabase
    .from('whatsapp_template_send_values')
    .upsert(
      { account_id: accountId, template_name: name, template_language: language, send_values: values, updated_at: new Date().toISOString() },
      { onConflict: 'account_id,template_name,template_language' },
    )
  if (error) throw new Error(`Could not keep what the template is filled with: ${error.message}`)
}

/** A day: long enough for Meta to fetch it however late a send is queued. */
const SIGNED_URL_SECONDS = 60 * 60 * 24

/**
 * The components to send for this template, the caller's plus whatever it
 * still needs. `template` is the variant being sent, as Meta lists it; with
 * none (Meta could not be read) the caller's components go as they are.
 *
 * The file is looked up only when the template wants one and the caller
 * attached none, so a send that already has everything costs one read.
 */
export async function fillTemplateComponents(
  admin: any,
  accountId: string,
  template: (MetaTemplateDefinition & { name: string; language: string }) | null | undefined,
  components: SendComponent[],
  who: Pick<TemplateSendInputs, 'firstName' | 'phone' | 'location'>,
): Promise<{ components: SendComponent[]; missing: string[] }> {
  if (!template?.components?.length) return { components, missing: [] }
  const values = await templateSendValues(admin, accountId, template.name, template.language).catch(() => null)

  let headerMedia: TemplateSendInputs['headerMedia'] = null
  if (templateMediaFormat(template) && !components.some((c) => c.type === 'header')) {
    const file = await templateMediaFile(admin, accountId, template.name, template.language).catch(() => null)
    if (file) {
      const { data } = await admin.storage.from('whatsapp-media').createSignedUrl(file.path, SIGNED_URL_SECONDS)
      if (data?.signedUrl) headerMedia = { link: data.signedUrl, filename: file.filename }
    }
  }
  return completeTemplateComponents(template, components, { ...who, values, headerMedia })
}
