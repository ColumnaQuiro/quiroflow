import { STAFF_DOCUMENTS_BUCKET, STAFF_DOCUMENT_MAX_BYTES, STAFF_DOCUMENT_TYPES, staffDocumentPath } from '../utils/staffDocuments'

// Uploading a person's papers (owners): the file into the private
// team-member-files bucket, then its staff_documents row. If the row is
// refused the file is removed again, so the bucket never holds a file no
// row points at. Then one push per person (server/api/staff-documents/notify).
export interface StaffDocumentUpload {
  accountId: string
  teamMemberId: string
  file: File
  category: string
  /** YYYY-MM, for a payslip. */
  month?: string | null
  title?: string | null
}

export function useStaffDocumentUpload() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const authedFetch = useAuthedFetch()
  const t = useT()

  function problemWith(file: File): string {
    if (!STAFF_DOCUMENT_TYPES.includes(file.type)) return t(`${file.name}: only PDF, JPG or PNG.`, `${file.name}: solo PDF, JPG o PNG.`)
    if (file.size > STAFF_DOCUMENT_MAX_BYTES) return t(`${file.name}: over 20 MB.`, `${file.name}: pesa más de 20 MB.`)
    return ''
  }

  async function upload(u: StaffDocumentUpload): Promise<string> {
    const problem = problemWith(u.file)
    if (problem) throw new Error(problem)
    const path = staffDocumentPath(u.accountId, u.teamMemberId, u.file.name, crypto.randomUUID())
    const { error: upErr } = await supabase.storage.from(STAFF_DOCUMENTS_BUCKET).upload(path, u.file, { contentType: u.file.type, upsert: false })
    if (upErr) throw new Error(upErr.message)
    const { data, error } = await supabase
      .from('staff_documents')
      .insert({
        account_id: u.accountId,
        team_member_id: u.teamMemberId,
        category: u.category,
        period: u.month ? `${u.month}-01` : null,
        title: u.title?.trim() || null,
        storage_path: path,
        file_name: u.file.name.slice(0, 255),
        size_bytes: u.file.size,
        content_type: u.file.type,
        uploaded_by: store.teamMember?.id ?? null,
      })
      .select('id')
      .single()
    if (error || !data) {
      await supabase.storage.from(STAFF_DOCUMENTS_BUCKET).remove([path])
      throw new Error(error?.message ?? t("Couldn't save it.", 'No se ha podido guardar.'))
    }
    return data.id
  }

  /** Best-effort: a failed push does not undo an upload. */
  async function announce(ids: string[]) {
    if (!ids.length) return
    try {
      await authedFetch('/api/staff-documents/notify', { method: 'POST', body: { ids } })
    } catch (err) {
      console.warn('[staff-documents] notify failed', err)
    }
  }

  return { upload, announce, problemWith }
}
