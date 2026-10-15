import { issueFacturaServer } from '~/server/utils/facturas'

// "Vender producto" on a patient's Money tab: the products and quantities,
// and how it was paid. sell_products() takes the stock and writes the paid
// invoice, its lines and the payment in one transaction -- one invoice per
// IVA rate in the basket, since a factura carries one rate -- or refuses the
// lot (not enough on the shelf, a role that cannot take payments). Then each
// payment gets its factura at the PRODUCT's rate, the way every other payment
// gets one: a failure there is logged, never undoes the sale.
//
// Run with the caller's own client, so the function's permission checks see
// who is selling.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'billing_access')
  const body = await readBody<{ patientId?: string; items?: { productId?: string; quantity?: number }[]; method?: string }>(event)
  const items = (body?.items ?? [])
    .filter((i) => typeof i.productId === 'string' && Number.isInteger(i.quantity) && (i.quantity ?? 0) > 0)
    .map((i) => ({ product_id: i.productId, quantity: i.quantity }))
  if (!body?.patientId || !items.length || !body.method) {
    throw createError({ statusCode: 400, statusMessage: 'patientId, items and method are required' })
  }

  const { data: sold, error } = await supabase.rpc('sell_products', { p_patient_id: body.patientId, p_items: items, p_method: body.method })
  if (error) {
    throw createError({ statusCode: error.code === '42501' ? 403 : 400, statusMessage: error.message })
  }

  const facturas: (string | null)[] = []
  for (const row of sold ?? []) {
    facturas.push(
      await issueFacturaServer(supabase, {
        accountId: teamMember.account_id,
        patientId: body.patientId,
        paymentId: row.payment_id,
        amountCents: row.amount_cents,
        purpose: 'visit',
        serviceName: row.description,
        taxRateBp: row.tax_rate_bp,
      }),
    )
  }
  return { sales: (sold ?? []).map((row, i) => ({ invoiceId: row.invoice_id, paymentId: row.payment_id, amountCents: row.amount_cents, taxRateBp: row.tax_rate_bp, factura: facturas[i] })) }
})
