// Rebuilds the templates imported from PracticeHub from PracticeHub's own
// description of each form (utils/practicehubFormDefinition.ts says where
// that is and why the API cannot give it).
//
// The Form responses step leaves a template per form, guessed from one
// patient's answers. This replaces each one's blocks with the form as its
// editor has it: a signature block where the form had a signature, a
// drawable image with the same picture under it, every option of every
// question, what was required. A form nobody has answered yet has no
// template to replace, so it gets one, unless PracticeHub has it inactive.
//
// Only templates this import created are touched: they are found by
// external_reference, which nothing made in QuiroFlow carries.
//
// A clinic has a dozen forms, but each editor page is 200 KB and a function
// has ten seconds, so one call does what fits in its budget and hands back
// where to carry on from.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '~/types/database.types'
import { PracticeHubCodeNeeded, PracticeHubWebError, type PracticeHubWebClient } from '~/server/utils/practicehubWeb'
import { practiceHubDefinitionBlocks, practiceHubDefinitionImages, practiceHubDiagramUrl } from '~/utils/practicehubFormDefinition'
import { sniffImageType } from '~/utils/practicehubProfilePhotos'

const BUDGET_MS = 4_500
// A diagram is a line drawing; PracticeHub's own is 60 KB. Anything far past that is not one.
const MAX_DIAGRAM_BYTES = 8 * 1024 * 1024

export interface PracticeHubTemplateSync {
  /** Forms PracticeHub lists. */
  total: number
  /** Where the next call carries on, or null when every form has been done. */
  next: number | null
  updated: number
  created: number
  /** Inactive forms with no template here, left alone. */
  skipped: number
  /** Names of forms whose template could not be written. */
  failed: string[]
}

export function practiceHubTemplateReference(formId: string): string {
  return `PH-form-template-${formId}`
}

/**
 * Copies a form's picture into the clinic's doc-images, once, and says where.
 * One fixed name per picture, so a second run writes the same object again.
 */
async function storeDiagram(admin: SupabaseClient<Database>, accountId: string, formImageId: string): Promise<string | null> {
  const url = practiceHubDiagramUrl(formImageId)
  if (!url) return null
  const res = await fetch(url, { signal: AbortSignal.timeout(4_000) }).catch(() => null)
  if (!res?.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  const image = sniffImageType(bytes)
  if (!image || bytes.byteLength > MAX_DIAGRAM_BYTES) return null
  const name = formImageId.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'diagram'
  const path = `${accountId}/practicehub-${name}.${image.extension}`
  const { error } = await admin.storage.from('doc-images').upload(path, bytes, { contentType: image.contentType, upsert: true })
  return error ? null : path
}

export async function syncPracticeHubTemplates(
  admin: SupabaseClient<Database>,
  accountId: string,
  client: PracticeHubWebClient,
  after = 0,
): Promise<PracticeHubTemplateSync> {
  const started = Date.now()
  const forms = await client.formList()
  const result: PracticeHubTemplateSync = { total: forms.length, next: null, updated: 0, created: 0, skipped: 0, failed: [] }

  const { data: existing } = await admin.from('doc_templates').select('id, external_reference').eq('account_id', accountId).like('external_reference', 'PH-form-template-%')
  const templateIdByRef = new Map((existing ?? []).map((row) => [row.external_reference as string, row.id]))
  const imagePaths = new Map<string, string>()

  for (let i = Math.max(0, after); i < forms.length; i++) {
    if (i > after && Date.now() - started > BUDGET_MS) {
      result.next = i
      break
    }
    const form = forms[i]!
    const reference = practiceHubTemplateReference(form.id)
    const templateId = templateIdByRef.get(reference)
    if (!templateId && !form.active) {
      result.skipped++
      continue
    }

    try {
      const definition = await client.formDefinition(form.id)
      for (const imageId of practiceHubDefinitionImages(definition)) {
        if (imagePaths.has(imageId)) continue
        const path = await storeDiagram(admin, accountId, imageId)
        if (path) imagePaths.set(imageId, path)
      }
      const fields = practiceHubDefinitionBlocks(definition, { imagePaths }) as unknown as Json
      // An editor page with nothing in it would empty a template that works.
      if ((fields as unknown[]).length === 0) {
        result.skipped++
        continue
      }
      if (templateId) {
        const { error } = await admin.from('doc_templates').update({ fields }).eq('id', templateId).eq('account_id', accountId)
        if (error) throw new Error(error.message)
        result.updated++
      } else {
        const { error } = await admin.from('doc_templates').insert({ account_id: accountId, title: form.name || `PracticeHub ${form.id}`, fields, external_reference: reference })
        if (error) throw new Error(error.message)
        result.created++
      }
    } catch (e) {
      // A code PracticeHub wants, or its sign-in refusing, stops the whole run; one form's page does not.
      if (e instanceof PracticeHubCodeNeeded) throw e
      if (e instanceof PracticeHubWebError && (e.statusCode === 400 || e.statusCode === 429)) throw e
      result.failed.push(form.name || form.id)
    }
  }
  return result
}
