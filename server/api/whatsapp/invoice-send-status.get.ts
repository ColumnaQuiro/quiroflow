// Whether "Send by WhatsApp" can be pressed for this patient's receipts and
// invoices, and if not, why -- the same answer the send itself would give
// (invoiceWhatsAppReadiness), so the button's tooltip and the server agree.
// Only the reason leaves here: no number, no template name, no token.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'billing_access')
  const patientId = String(getQuery(event).patientId ?? '') || null
  const { blocker } = await invoiceWhatsAppReadiness(supabase, teamMember.account_id, patientId)
  return { blocker }
})
