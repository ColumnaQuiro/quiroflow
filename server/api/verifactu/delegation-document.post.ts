import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The representation document a clinic signs for the colaboración social
// route (Resolución of 18 Dec 2024, BOE-A-2024-27600), as a PDF. QuiroFlow
// keeps it for as long as it sends for the clinic, and shows it to the AEAT
// if asked; it is what makes the platform's submissions lawful for that NIF.
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireOwner(event)
  const body = await readBody<{ fileBase64?: string; fileName?: string }>(event)

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: delegation } = await admin.from('verifactu_delegations').select('route').eq('account_id', teamMember.account_id).maybeSingle()
  if (delegation?.route !== 'colaboracion_social') {
    throw createError({ statusCode: 409, statusMessage: 'Choose “QuiroFlow sends for you — signed document” first' })
  }

  const pdf = Buffer.from((body?.fileBase64 ?? '').replace(/^data:[^,]*,/, ''), 'base64')
  // A PDF starts with "%PDF-". Checked rather than trusted from the name: a
  // phone photo renamed .pdf is not a document anyone can file.
  if (pdf.length === 0 || pdf.length > MAX_DOCUMENT_BYTES || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw createError({ statusCode: 400, statusMessage: 'Upload the signed document as a PDF of up to 5 MB' })
  }
  const fileName = (body?.fileName ?? 'documento-representacion.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 120)

  const { error } = await admin
    .from('verifactu_delegations')
    .update({ signed_document_base64: pdf.toString('base64'), signed_document_name: fileName, signed_document_uploaded_at: new Date().toISOString() })
    .eq('account_id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true, fileName }
})
