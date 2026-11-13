import { TEMPLATE_MEDIA_FOLDER, parseTemplateMediaName } from '~/utils/whatsappTemplateDraft'

// The files templates were created with in QuiroFlow (whatsappTemplateCreate),
// kept in the private whatsapp-media bucket under
// <account>/templates/<name>.<language>.<timestamp>.<file>. Read with the
// service role: the bucket has no browser access at all.

export interface TemplateMediaFile {
  path: string
  filename: string
}

/** The newest file kept for each "name.language", from one listing of the folder. */
export async function templateMediaFiles(admin: any, accountId: string): Promise<Map<string, TemplateMediaFile>> {
  const found = new Map<string, TemplateMediaFile & { at: number }>()
  const folder = `${accountId}/${TEMPLATE_MEDIA_FOLDER}`
  const { data } = await admin.storage.from('whatsapp-media').list(folder, { limit: 1000 })
  for (const object of data ?? []) {
    const parsed = parseTemplateMediaName(object.name)
    if (!parsed) continue
    const key = `${parsed.name}.${parsed.language}`
    const seen = found.get(key)
    if (!seen || parsed.at > seen.at) found.set(key, { path: `${folder}/${object.name}`, filename: parsed.filename, at: parsed.at })
  }
  return found
}

/** The file one template was created with, or null when it was made elsewhere (WhatsApp Manager) or has none. */
export async function templateMediaFile(admin: any, accountId: string, name: string, language: string): Promise<TemplateMediaFile | null> {
  return (await templateMediaFiles(admin, accountId)).get(`${name}.${language}`) ?? null
}
