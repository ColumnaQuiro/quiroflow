/**
 * The tax breakdown a factura is issued under.
 *
 * Shared by the two issuing paths -- useFacturas() in the browser and
 * issueFacturaServer() for money that arrives with nobody at a screen -- for
 * the same reason facturaKind() is shared: two copies of a rule about tax is
 * two chances to disagree about what a patient was charged.
 *
 * ColumnaQuiro's services are exempt under art. 20.Uno.3 of Ley 37/1992
 * (asistencia sanitaria prestada por profesionales), so base equals total and
 * the cuota is zero. That is not hardcoded here: the account carries its own
 * rate and exemption code, because a clinic that is not exempt has to be able
 * to issue a taxed factura without a code change.
 *
 * The code is stored, not the sentence. AEAT's CausaExencion values are what
 * a registro de facturación carries, and keeping the wording out of the
 * database means a better-phrased clause can be printed on future documents
 * without rewriting invoices already issued.
 */
export interface FacturaTax {
  taxBaseCents: number
  taxRateBp: number
  taxAmountCents: number
  taxExemptionCode: string | null
}

export interface AccountTaxDefaults {
  factura_tax_rate_bp?: number | null
  factura_tax_exemption_code?: string | null
}

/**
 * Splits a gross amount into base and cuota.
 *
 * The amount handed in is what the patient paid, so a taxed operation works
 * backwards from the gross rather than adding tax on top -- the total on the
 * document has to equal the money that changed hands, to the cent, or the
 * factura contradicts the payment it was issued for.
 */
export function facturaTaxFor(amountCents: number, account: AccountTaxDefaults | null | undefined): FacturaTax {
  const exemptionCode = account?.factura_tax_exemption_code ?? null
  const rateBp = exemptionCode ? 0 : (account?.factura_tax_rate_bp ?? 0)

  if (rateBp <= 0) {
    return { taxBaseCents: amountCents, taxRateBp: 0, taxAmountCents: 0, taxExemptionCode: exemptionCode }
  }

  // Round the base, then derive the cuota by subtraction. Rounding both
  // independently is how base + cuota ends up a cent away from the total.
  const base = Math.round((amountCents * 10000) / (10000 + rateBp))
  return {
    taxBaseCents: base,
    taxRateBp: rateBp,
    taxAmountCents: amountCents - base,
    taxExemptionCode: null,
  }
}

/** The clause an exempt invoice has to carry on its face. */
const EXEMPTION_CLAUSES: Record<string, string> = {
  E1: 'Operación exenta de IVA (art. 20 de la Ley 37/1992)',
  E2: 'Operación exenta de IVA (art. 21 de la Ley 37/1992)',
  E3: 'Operación exenta de IVA (art. 22 de la Ley 37/1992)',
  E4: 'Operación exenta de IVA (arts. 23 y 24 de la Ley 37/1992)',
  E5: 'Operación exenta de IVA (art. 25 de la Ley 37/1992)',
  E6: 'Operación exenta de IVA',
}

export function exemptionClause(code: string | null | undefined): string | null {
  return code ? (EXEMPTION_CLAUSES[code] ?? EXEMPTION_CLAUSES.E6!) : null
}
