// Settings > Activity log for reads a family member does through the app or
// the portal (family accounts, 20261106053857_family_accounts.sql). Called
// through the CALLER's client after the read it records has been allowed:
// log_family_access writes nothing for the person's own record, and refuses
// anybody the caller may not act for -- a staff member downloading a file,
// say, who is logged by their own routes. So a refusal here is expected and
// never fails the request.
type Kind = 'record_opened' | 'file_viewed' | 'file_downloaded' | 'invoice_pdf'

export async function logFamilyAccess(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  patientId: string | null | undefined,
  kind: Kind,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!patientId) return
  try {
    await supabase.rpc('log_family_access', { p_patient_id: patientId, p_kind: kind, ...(detail ? { p_detail: detail } : {}) })
  } catch {
    // Best effort: the read has already been allowed.
  }
}
