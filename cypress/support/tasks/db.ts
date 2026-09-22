import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Fixed local-dev defaults from `supabase start` — safe to keep here since
// they're the well-known Supabase CLI local demo credentials, not secrets.
const SUPABASE_URL = process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.NUXT_PUBLIC_SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_ROLE_KEY =
  process.env.NUXT_SUPABASE_SECRET_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// T is inferred from Supabase's actual response union (one branch has
// `data: Row`, the other `data: null`), so T itself already resolves to
// `Row | null` at the call site -- returning plain T would still carry the
// null-ness through. NonNullable<T> strips it from the return type, backed
// by a real runtime check right above the cast.
function unwrap<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error
  if (result.data == null) throw new Error('Expected a row but got null')
  return result.data as NonNullable<T>
}

// For a plain .update()/.delete() with no trailing .select() -- Supabase
// returns `data: null` on a SUCCESSFUL call like that (PostgREST only
// returns affected rows when a .select() asks for them), so unlike
// unwrap() above, null here is the normal outcome, not a failure signal.
function assertOk(result: { error: unknown }): void {
  if (result.error) throw result.error
}

/** Creates a fresh auth user + account + clinic + default roles via the same RPC onboarding uses. */
async function createStaffAccount(opts: {
  email: string
  password: string
  accountName: string
  clinicName: string
  ownerName?: string
}) {
  const { email, password, accountName, clinicName, ownerName } = opts

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userErr) throw userErr
  const userId = userData.user!.id

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password })
  if (signInErr) throw signInErr

  const { data: rpcRows, error: rpcErr } = await userClient.rpc('create_account_with_owner', {
    p_account_name: accountName,
    p_clinic_name: clinicName,
    p_owner_name: ownerName ?? null,
  })
  if (rpcErr) throw rpcErr
  const { account_id: accountId, clinic_id: clinicId } = (rpcRows as { account_id: string; clinic_id: string }[])[0]

  const account = unwrap(await admin.from('accounts').select('id, slug, name').eq('id', accountId).single())
  const teamMember = unwrap(
    await admin.from('team_members').select('id').eq('account_id', accountId).eq('user_id', userId).single(),
  )
  const roles = unwrap(await admin.from('account_roles').select('id, name').eq('account_id', accountId))

  return {
    email,
    password,
    userId,
    accountId,
    accountSlug: account.slug as string,
    accountName: account.name as string,
    clinicId,
    teamMemberId: teamMember.id as string,
    roles: roles as { id: string; name: string }[],
  }
}

/** Adds a second team member to an existing account with a specific role (by role name), for RBAC tests. */
async function createTeamMemberWithRole(opts: {
  accountId: string
  clinicId: string
  roleName: string
  email: string
  password: string
  fullName?: string
  isPractitioner?: boolean
}) {
  const { accountId, clinicId, roleName, email, password, fullName, isPractitioner } = opts

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userErr) throw userErr
  const userId = userData.user!.id

  const role = unwrap(
    await admin.from('account_roles').select('id').eq('account_id', accountId).eq('name', roleName).single(),
  )

  const teamMember = unwrap(
    await admin
      .from('team_members')
      .insert({
        account_id: accountId,
        user_id: userId,
        full_name: fullName ?? email,
        role: 'practitioner',
        role_id: role.id,
        is_owner: false,
        // Still passes through enforce_practitioner_seats (0150) like any
        // other insert -- callers relying on this to seed practitioners past
        // an allowance need to raise it (e.g. db:setExtraProfessionals)
        // first, same as a real client would have to.
        is_practitioner: isPractitioner ?? false,
      })
      .select('id')
      .single(),
  )
  await admin.from('team_member_clinics').insert({ team_member_id: teamMember.id, clinic_id: clinicId })

  return { email, password, userId, teamMemberId: teamMember.id as string }
}

/** The attribution row a public booking recorded, if any -- keyed by account since the spec does not know the appointment id. */
async function bookingAttribution(opts: { accountId: string }) {
  const { data } = await admin
    .from('booking_attribution')
    .select('appointment_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, click_id_source, referrer, landing_path')
    .eq('account_id', opts.accountId)
    .order('created_at', { ascending: false })
  return { rows: data ?? [] }
}

/** A role's permissions exactly as seed_account_roles left them -- for asserting the seeded defaults. */
async function rolePermissions(opts: { accountId: string; roleName: string }) {
  const { accountId, roleName } = opts
  const role = unwrap(
    await admin.from('account_roles').select('id, name, is_system, permissions').eq('account_id', accountId).eq('name', roleName).single(),
  )
  return {
    roleId: role.id as string,
    isSystem: role.is_system as boolean,
    permissions: role.permissions as Record<string, unknown>,
  }
}

/** Merges a partial permissions patch into a role's permissions jsonb. */
async function setRolePermissions(opts: { accountId: string; roleName: string; patch: Record<string, unknown> }) {
  const { accountId, roleName, patch } = opts
  const role = unwrap(
    await admin
      .from('account_roles')
      .select('id, permissions')
      .eq('account_id', accountId)
      .eq('name', roleName)
      .single(),
  )
  const merged = { ...(role.permissions as Record<string, unknown>), ...patch }
  assertOk(await admin.from('account_roles').update({ permissions: merged }).eq('id', role.id))
  return { roleId: role.id as string, permissions: merged }
}

/** Directly sets a test account's billing status -- bypasses Stripe entirely, for exercising the banner/lock-screen UI. */
async function setSubscriptionStatus(opts: { accountId: string; status: 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled' }) {
  const { accountId, status } = opts
  assertOk(await admin.from('subscriptions').update({ status }).eq('account_id', accountId))
  return { accountId, status }
}

/**
 * Marks a test account as comped -- complimentary access, priced at 0, the
 * shape QuiroFlow's own account has. Bypasses the admin panel that normally
 * grants it, for exercising the read-only plan view a comped account sees.
 */
async function setComped(opts: { accountId: string; comped: boolean }) {
  const { accountId, comped } = opts
  assertOk(await admin.from('subscriptions').update({ comped }).eq('account_id', accountId))
  return { accountId, comped }
}

/**
 * Directly sets a test account's extra-professional seat count -- bypasses
 * Stripe entirely (the real path is the platform-billing webhook reacting to
 * a Checkout/subscription-update event), for exercising
 * practitioner_seat_allowance()'s `included_professionals + extra_professionals`
 * math and the enforce_practitioner_seats trigger it feeds, without needing
 * live Stripe credentials in CI.
 */
async function setExtraProfessionals(opts: { accountId: string; extraProfessionals: number }) {
  const { accountId, extraProfessionals } = opts
  assertOk(await admin.from('subscriptions').update({ extra_professionals: extraProfessionals }).eq('account_id', accountId))
  return { accountId, extraProfessionals }
}

/**
 * Directly sets a test account's Stripe customer/subscription ids -- bypasses
 * Stripe entirely, same as setSubscriptionStatus/setExtraProfessionals do,
 * for exercising UI that only renders once a "real" (non-trial) subscription
 * exists, without needing live Stripe credentials in CI.
 */
async function setSubscriptionStripeIds(opts: { accountId: string; stripeCustomerId: string; stripeSubscriptionId: string }) {
  const { accountId, stripeCustomerId, stripeSubscriptionId } = opts
  assertOk(
    await admin
      .from('subscriptions')
      .update({ stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId })
      .eq('account_id', accountId),
  )
  return { accountId, stripeCustomerId, stripeSubscriptionId }
}

/**
 * A patient document with a chosen author -- `createdBy` is a team_members id,
 * or left unset to seed the unattributed shape every PracticeHub-imported
 * document has. That null case is the one worth seeding deliberately: it is
 * what docs_files_scope has to keep visible.
 */
async function createPatientDoc(opts: { accountId: string; patientId: string; title: string; createdBy?: string }) {
  const { accountId, patientId, title, createdBy } = opts
  const doc = unwrap(
    await admin
      .from('patient_docs')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        title,
        fields: [],
        created_by: createdBy ?? null,
      })
      .select('id')
      .single(),
  )
  return { docId: doc.id as string }
}

async function createPatient(opts: {
  accountId: string
  clinicId: string
  firstName: string
  lastName?: string
  email?: string
  dateOfBirth?: string
  // Who the patient belongs to. Left unset by default, which is what most
  // specs want -- it is also how income attribution falls back for money with
  // no appointment behind it (see utils/incomeAttribution).
  defaultPractitionerId?: string
  /** Adds a contact number, which is what the lead-to-patient match reads. */
  phone?: string
  phoneCountryCode?: string
  /** Whether invoices are emailed to them. Off by default, as in the schema. */
  invoiceEmailEnabled?: boolean
}) {
  const { accountId, clinicId, firstName, lastName, email, dateOfBirth, defaultPractitionerId } = opts
  const patient = unwrap(
    await admin
      .from('patients')
      .insert({
        account_id: accountId,
        clinic_id: clinicId,
        first_name: firstName,
        last_name: lastName ?? null,
        email: email ?? null,
        date_of_birth: dateOfBirth ?? null,
        default_practitioner_id: defaultPractitionerId ?? null,
        ...(opts.invoiceEmailEnabled === undefined ? {} : { invoice_email_enabled: opts.invoiceEmailEnabled }),
      })
      .select('id, first_name, last_name')
      .single(),
  )

  if (opts.phone) {
    assertOk(
      await admin.from('patient_contact_numbers').insert({
        account_id: accountId,
        patient_id: (patient as { id: string }).id,
        number: opts.phone,
        country_code: opts.phoneCountryCode ?? 'ES',
        is_whatsapp: true,
      }),
    )
  }

  return patient as { id: string; first_name: string; last_name: string | null }
}

async function createAppointmentType(opts: {
  accountId: string
  name: string
  durationMinutes?: number
  defaultPriceCents?: number
  onlineBookingEnabled?: boolean
}) {
  const { accountId, name, durationMinutes, defaultPriceCents, onlineBookingEnabled } = opts
  const row = unwrap(
    await admin
      .from('appointment_types')
      .insert({
        account_id: accountId,
        name,
        duration_minutes: durationMinutes ?? 30,
        default_price_cents: defaultPriceCents ?? 0,
        online_booking_enabled: onlineBookingEnabled ?? true,
      })
      .select('id, name, duration_minutes')
      .single(),
  )
  return row as { id: string; name: string; duration_minutes: number }
}

async function createServiceProduct(opts: { accountId: string; name: string; priceCents?: number }) {
  const { accountId, name, priceCents } = opts
  const row = unwrap(
    await admin
      .from('services_products')
      .insert({ account_id: accountId, name, price_cents: priceCents ?? 0 })
      .select('id, name, price_cents')
      .single(),
  )
  return row as { id: string; name: string; price_cents: number }
}

/** Enables online booking for a clinic with generous Mon-Fri business hours, for public booking specs. */
async function enableOnlineBooking(opts: { clinicId: string }) {
  const businessHours = {
    mon: [['08:00', '19:00']],
    tue: [['08:00', '19:00']],
    wed: [['08:00', '19:00']],
    thu: [['08:00', '19:00']],
    fri: [['08:00', '19:00']],
    sat: [],
    sun: [],
  }
  assertOk(
    await admin
      .from('clinics')
      .update({ online_booking_enabled: true, business_hours: businessHours })
      .eq('id', opts.clinicId),
  )
  return { businessHours }
}

/** Adds 'email' to the account's confirmation channels -- accounts default to whatsapp-only. */
async function enableEmailConfirmations(opts: { accountId: string }) {
  assertOk(
    await admin
      .from('accounts')
      .update({ appointment_confirmation_enabled: true, appointment_confirmation_channels: ['whatsapp', 'email'] })
      .eq('id', opts.accountId),
  )
  return null
}

async function createInvoice(opts: {
  accountId: string
  patientId: string
  invoiceNumber?: string
  totalCents?: number
  status?: string
  /** The visit this charge is for. Most invoices have one; the ledger and
   *  the appointment row both read it. */
  appointmentId?: string
}) {
  const { accountId, patientId, invoiceNumber, totalCents, status } = opts
  const row = unwrap(
    await admin
      .from('invoices')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        invoice_number: invoiceNumber ?? `INV-${Date.now()}`,
        ...(totalCents !== undefined ? { total_cents: totalCents } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(opts.appointmentId !== undefined ? { appointment_id: opts.appointmentId } : {}),
      })
      .select('id, invoice_number')
      .single(),
  )
  return row as { id: string; invoice_number: string }
}

async function nextInvoiceNumber(opts: { accountId: string; prefix?: string }) {
  const { accountId, prefix } = opts
  const { data, error } = await admin.rpc('next_invoice_number', {
    p_account_id: accountId,
    ...(prefix ? { p_prefix: prefix } : {}),
  })
  if (error) throw error
  return data as string
}

async function deleteInvoice(opts: { invoiceId: string }) {
  const { error } = await admin.from('invoices').delete().eq('id', opts.invoiceId)
  if (error) throw error
  return null
}

async function createPayment(opts: {
  accountId: string
  amountCents: number
  method: string
  // A payment names its own patient since 0170. invoiceId stays optional so a
  // spec can seed money on account -- a payment settling no particular charge.
  patientId?: string
  invoiceId?: string
  // A deposit put against a bono. A bono sold here raises no invoice -- its
  // price sits on the purchase as owed_cents and payments come off it through
  // this column -- so a part-paid bono can only be seeded this way.
  packagePurchaseId?: string
  // 'on_account' is the one that matters to the ledger: money added as credit
  // writes a payment AND an account_credits row for the same euros, and only
  // the purpose tells them apart afterwards.
  purpose?: 'visit' | 'bono' | 'membership' | 'on_account'
  // ISO timestamp. Defaults to now; set it to put money in an earlier period,
  // which is the only way to exercise anything that compares two windows.
  paidAt?: string
}) {
  const { accountId, invoiceId, amountCents, method, packagePurchaseId, purpose, paidAt } = opts
  let patientId = opts.patientId
  if (!patientId) {
    if (!invoiceId) throw new Error('createPayment needs patientId or invoiceId')
    const inv = unwrap(await admin.from('invoices').select('patient_id').eq('id', invoiceId).single())
    patientId = (inv as { patient_id: string }).patient_id
  }
  const row = unwrap(
    await admin
      .from('payments')
      .insert({ account_id: accountId, patient_id: patientId, invoice_id: invoiceId ?? null, package_purchase_id: packagePurchaseId ?? null, amount_cents: amountCents, method, ...(purpose ? { purpose } : {}), ...(paidAt ? { paid_at: paidAt } : {}) })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

async function settleImportedInvoices(opts: { accountId: string }) {
  const { data, error } = await admin.rpc('settle_imported_invoices', { p_account_id: opts.accountId })
  if (error) throw error
  return data as number
}

// By id, for a spec that seeded the invoice itself and wants to see what
// taking a payment through the UI did to it. invoiceStatusByRef answers the
// same question for an imported row, which is keyed on its PracticeHub
// reference instead.
async function invoiceById(opts: { invoiceId: string }) {
  const { data, error } = await admin.from('invoices').select('id, status, total_cents').eq('id', opts.invoiceId).maybeSingle()
  if (error) throw error
  return data as { id: string; status: string; total_cents: number } | null
}

async function invoiceStatusByRef(opts: { accountId: string; externalReference: string }) {
  const { data, error } = await admin
    .from('invoices')
    .select('status')
    .eq('account_id', opts.accountId)
    .eq('external_reference', opts.externalReference)
    .maybeSingle()
  if (error) throw error
  return (data as { status: string } | null)?.status ?? null
}

async function createImportedInvoice(opts: {
  accountId: string
  patientId: string
  totalCents: number
  createdAt: string
  externalReference: string
}) {
  const row = unwrap(
    await admin
      .from('invoices')
      .insert({
        account_id: opts.accountId,
        patient_id: opts.patientId,
        invoice_number: `PHI-${opts.externalReference}`,
        status: 'unpaid',
        total_cents: opts.totalCents,
        created_at: opts.createdAt,
        external_reference: opts.externalReference,
      })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

async function createImportedPayment(opts: {
  accountId: string
  patientId: string
  amountCents: number
  paidAt: string
  externalReference: string
}) {
  const row = unwrap(
    await admin
      .from('payments')
      .insert({
        account_id: opts.accountId,
        patient_id: opts.patientId,
        invoice_id: null,
        amount_cents: opts.amountCents,
        method: 'cash',
        paid_at: opts.paidAt,
        external_reference: opts.externalReference,
      })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

async function createFactura(opts: {
  accountId: string
  patientId: string
  paymentId: string
  number: string
  kind?: string
  description: string
  amountCents: number
}) {
  const row = unwrap(
    await admin
      .from('facturas')
      .insert({
        account_id: opts.accountId,
        patient_id: opts.patientId,
        payment_id: opts.paymentId,
        number: opts.number,
        kind: opts.kind ?? 'simplified',
        description: opts.description,
        amount_cents: opts.amountCents,
        // A seeded factura carries the same exempt breakdown the issuing code
        // produces, because tax_base_cents is NOT NULL on purpose: a factura
        // without a base is not a document anyone may hand a patient, and a
        // seeder that could create one would let a spec pass against a row
        // production cannot produce.
        tax_base_cents: opts.amountCents,
        tax_rate_bp: 0,
        tax_amount_cents: 0,
        tax_exemption_code: 'E1',
      })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

/**
 * The two flags that change what the record is allowed to offer: a minor has
 * no Communications tab at all, and a do-not-contact patient has every send
 * affordance removed rather than disabled. Both are columns on patients (see
 * 0063_patient_status_minor_tutor_dnc.sql), and nothing could set them from a
 * spec before.
 */
async function setPatientContactFlags(opts: { patientId: string; isMinor?: boolean; doNotContact?: boolean }) {
  const patch: Record<string, boolean> = {}
  if (opts.isMinor !== undefined) patch.is_minor = opts.isMinor
  if (opts.doNotContact !== undefined) patch.do_not_contact = opts.doNotContact
  const { error } = await admin.from('patients').update(patch).eq('id', opts.patientId)
  if (error) throw error
  return null
}

async function setPatientNif(opts: { patientId: string; nationalId: string | null }) {
  const { error } = await admin.from('patients').update({ national_id: opts.nationalId }).eq('id', opts.patientId)
  if (error) throw error
  return null
}

async function createPackageTemplate(opts: { accountId: string; name: string; sessionCount: number; priceCents: number }) {
  const row = unwrap(
    await admin
      .from('packages')
      .insert({ account_id: opts.accountId, name: opts.name, session_count: opts.sessionCount, price_cents: opts.priceCents })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

async function createAccountCredit(opts: {
  accountId: string
  patientId: string
  amountCents: number
  reason?: string
  // The payment this row restates, for seeding money added on account -- which
  // writes a payment and a credit row for the same euros. Without it the row
  // reads as an adjustment and the balance counts the money twice.
  paymentId?: string
}) {
  const row = unwrap(
    await admin
      .from('account_credits')
      .insert({ account_id: opts.accountId, patient_id: opts.patientId, amount_cents: opts.amountCents, reason: opts.reason ?? null, payment_id: opts.paymentId ?? null })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

async function paymentsFor(opts: { patientId: string }) {
  const { data, error } = await admin
    .from('payments')
    .select('amount_cents, method, purpose, invoice_id')
    .eq('patient_id', opts.patientId)
    .order('paid_at')
  if (error) throw error
  return data
}

async function facturasFor(opts: { patientId: string }) {
  const { data, error } = await admin
    .from('facturas')
    .select('id, number, kind, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, recipient_nif, payment_id, created_by, rectifies_factura_id')
    .eq('patient_id', opts.patientId)
    .order('issued_at')
  if (error) throw error
  return data
}

/**
 * Inserts a factura the way the PREVIOUS release did: no tax columns at all.
 *
 * Exists to prove the database fills them in. Without that, applying the tax
 * migration before deploying the code would make every factura insert violate
 * a NOT NULL constraint, and useFacturas() swallows errors, so facturas would
 * stop being issued silently.
 */
async function createFacturaWithoutTax(opts: {
  accountId: string
  patientId: string
  paymentId: string
  number: string
  description: string
  amountCents: number
}) {
  const { data, error } = await admin
    .from('facturas')
    .insert({
      account_id: opts.accountId,
      patient_id: opts.patientId,
      payment_id: opts.paymentId,
      number: opts.number,
      kind: 'simplified',
      description: opts.description,
      amount_cents: opts.amountCents,
    } as never)
    .select('id, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code')
    .single()
  if (error) throw error
  return data
}

/**
 * Runs the huella functions directly, so the algorithm can be checked against
 * AEAT's own worked example rather than only against our own output.
 */
async function huellaFor(opts: {
  issuerNif: string
  serieNumber: string
  issuedOn: string
  invoiceType: string
  cuotaTotalCents: number
  importeTotalCents: number
  previousHuella: string | null
  generatedAt: string
}) {
  const { data, error } = await admin.rpc('factura_huella_probe', {
    p_issuer_nif: opts.issuerNif,
    p_serie_number: opts.serieNumber,
    p_issued_on: opts.issuedOn,
    p_invoice_type: opts.invoiceType,
    p_cuota_total_cents: opts.cuotaTotalCents,
    p_importe_total_cents: opts.importeTotalCents,
    p_previous_huella: opts.previousHuella,
    p_generated_at: opts.generatedAt,
  })
  if (error) throw error
  return data
}

/**
 * Asks the verifier about an account as somebody who should not be allowed to.
 *
 * `as: 'anon'` uses the anon key alone -- the key that ships in the client
 * bundle. `as: 'outsider'` signs in as a real user of a DIFFERENT account,
 * which is the case a permission check can pass by accident.
 *
 * Returns what happened rather than throwing, so the test can assert on the
 * refusal instead of on a stack trace.
 */
async function verifyFacturaChainAs(opts: {
  accountId: string
  as: 'anon' | 'outsider'
  email?: string
  password?: string
}) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  if (opts.as === 'outsider') {
    const { error } = await client.auth.signInWithPassword({ email: opts.email!, password: opts.password! })
    if (error) throw error
  }

  const { data, error } = await client.rpc('verify_factura_chain', { p_account_id: opts.accountId })
  return {
    refused: Boolean(error),
    message: error?.message ?? null,
    rows: data ?? null,
  }
}

/**
 * Asks for another account's transmission log as somebody who should not see it.
 *
 * Same shape as verifyFacturaChainAs: `anon` is the key that ships in the
 * client bundle, `outsider` is a real user of a different clinic -- the
 * caller a permission check passes by accident because they look legitimate.
 */
async function awaitingAeatAs(opts: {
  accountId: string
  as: 'anon' | 'outsider'
  email?: string
  password?: string
}) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  if (opts.as === 'outsider') {
    const { error } = await client.auth.signInWithPassword({ email: opts.email!, password: opts.password! })
    if (error) throw error
  }

  const { data, error } = await client.rpc('factura_records_awaiting_aeat', { p_account_id: opts.accountId })
  return { refused: Boolean(error), message: error?.message ?? null, rows: data ?? null }
}

/** IndicadorMultiplesOT as the database derives it, not as anyone configured it. */
async function indicadorMultiplesOt() {
  const { data, error } = await admin.rpc('sif_indicador_multiples_ot')
  if (error) throw error
  return data as string
}

/** The obligado count the indicator above is derived from. */
async function accountCount() {
  const { count, error } = await admin.from('accounts').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

/** Records the AEAT has not acknowledged yet, in chain order. */
async function awaitingAeat(opts: { accountId: string }) {
  const { data, error } = await admin.rpc('factura_records_awaiting_aeat', { p_account_id: opts.accountId })
  if (error) throw error
  return data
}

/**
 * Writes what the AEAT said about a record.
 *
 * Stands in for the sender, which does not exist yet -- the point of the
 * test is the consequence of each answer, not the transport. `status` takes
 * AEAT's own vocabulary so the test reads like their documentation.
 */
async function recordAeatSubmission(opts: {
  accountId: string
  facturaRecordId: string
  attempt?: number
  status: 'queued' | 'sent' | 'transport_error' | 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'
  csv?: string
  errorCode?: string
  errorMessage?: string
}) {
  const { data, error } = await admin
    .from('factura_record_submissions')
    .insert({
      account_id: opts.accountId,
      factura_record_id: opts.facturaRecordId,
      attempt: opts.attempt ?? 1,
      status: opts.status,
      aeat_csv: opts.csv ?? null,
      error_code: opts.errorCode ?? null,
      error_message: opts.errorMessage ?? null,
      sent_at: new Date().toISOString(),
      responded_at: new Date().toISOString(),
    })
    .select('id, status, attempt')
    .single()
  if (error) throw error
  return data
}

/** The registro de facturación chain for an account, oldest first. */
async function facturaRecordsFor(opts: { accountId: string }) {
  const { data, error } = await admin
    .from('factura_records')
    .select('id, sequence, factura_id, record_type, invoice_type, serie_number, cuota_total_cents, importe_total_cents, previous_huella, huella, huella_spec_version')
    .eq('account_id', opts.accountId)
    .order('sequence')
  if (error) throw error
  return data
}

/**
 * Tries to alter a record, and reports what happened.
 *
 * The append-only guarantee is the whole point of the table, so a test has to
 * attempt the thing that must fail rather than trust a comment saying it does.
 */
async function tryMutateFacturaRecord(opts: { id: string }) {
  const update = await admin.from('factura_records').update({ huella: 'TAMPERED' }).eq('id', opts.id)
  const del = await admin.from('factura_records').delete().eq('id', opts.id)
  return {
    updateBlocked: Boolean(update.error),
    updateMessage: update.error?.message ?? null,
    deleteBlocked: Boolean(del.error),
  }
}

/** What the chain verifier says about an account: one row per problem. */
async function verifyFacturaChain(opts: { accountId: string }) {
  const { data, error } = await admin.rpc('verify_factura_chain', { p_account_id: opts.accountId })
  if (error) throw error
  return data
}

/**
 * Rebuilds an account's chain under a named formula version.
 *
 * A real production function, not a test hook -- it is how a chain built
 * under a superseded huella formula is brought forward. Used here to put a
 * chain into the state the verifier has to describe correctly.
 */
async function rebuildFacturaHuellas(opts: { accountId: string; specVersion: string }) {
  const { data, error } = await admin.rpc('rebuild_factura_huellas', {
    p_account_id: opts.accountId,
    p_spec_version: opts.specVersion,
  })
  if (error) throw error
  return data
}

async function nextFacturaNumber(opts: { accountId: string }) {
  const { data, error } = await admin.rpc('next_factura_number', { p_account_id: opts.accountId })
  if (error) throw error
  return data as string
}

async function paymentById(opts: { paymentId: string }) {
  const { data, error } = await admin
    .from('payments')
    .select('id, patient_id, invoice_id, amount_cents, method')
    .eq('id', opts.paymentId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function createPackagePurchase(opts: {
  accountId: string
  patientId: string
  packageName?: string
  sessionsTotal?: number
  sessionsUsed?: number
  priceCents?: number
  // The invoice the bono is billed on. Set it to test a part-paid bono: the
  // card reads what is owed off this invoice's payments.
  invoiceId?: string
  // What PracticeHub said was outstanding, for a migrated bono -- which has
  // no invoice at all, so this is the only record of the debt.
  owedCents?: number
}) {
  const { accountId, patientId, packageName, sessionsTotal, sessionsUsed, priceCents, invoiceId, owedCents } = opts
  const row = unwrap(
    await admin
      .from('package_purchases')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        package_name: packageName ?? 'Bono 12',
        sessions_total: sessionsTotal ?? 12,
        sessions_used: sessionsUsed ?? 0,
        price_cents: priceCents ?? 52800,
        purchased_at: new Date().toISOString(),
        ...(invoiceId ? { invoice_id: invoiceId } : {}),
        ...(owedCents === undefined ? {} : { owed_cents: owedCents }),
      })
      .select('id, package_name, sessions_total, sessions_used, price_cents')
      .single(),
  )
  return row as { id: string; package_name: string; sessions_total: number; sessions_used: number; price_cents: number }
}

/**
 * Calls create_public_booking with the ANON key, the way the booking widget
 * does -- and the way anything that is not the widget would.
 *
 * Deliberately not the service-role client: the point of the guards inside
 * that function is that they hold for a caller who never loaded the form, so
 * a test using admin privileges would prove nothing about them.
 */
async function callPublicBookingAsAnon(args: Record<string, unknown>) {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await anon.rpc('create_public_booking', args as never)
  return { error: error?.message ?? null }
}

/** Gives a second patient the run of someone else's bono -- a family sharing one. */
async function sharePackageWith(opts: { accountId: string; packagePurchaseId: string; patientId: string }) {
  const row = unwrap(
    await admin
      .from('package_purchase_shares')
      .insert({ account_id: opts.accountId, package_purchase_id: opts.packagePurchaseId, patient_id: opts.patientId })
      .select('id')
      .single(),
  )
  return row as { id: string }
}

// Reads back what "Log session" wrote, so the spec can assert the money side
// (invoice, payment, credit debit) and not just the on-screen counter.
async function packageSessionEffects(opts: { patientId: string; packagePurchaseId: string }) {
  const { patientId, packagePurchaseId } = opts
  const purchase = unwrap(await admin.from('package_purchases').select('sessions_used').eq('id', packagePurchaseId).single())
  const appointments = unwrap(await admin.from('appointments').select('id, status, practitioner_id').eq('patient_id', patientId))
  const invoices = unwrap(await admin.from('invoices').select('id, status, total_cents, appointment_id').eq('patient_id', patientId))
  const credits = unwrap(await admin.from('account_credits').select('amount_cents, reason').eq('patient_id', patientId))
  const sessions = unwrap(
    await admin.from('package_sessions').select('amount_cents, appointment_id, package_purchase_id').eq('patient_id', patientId),
  )
  const invoiceIds = (invoices as { id: string }[]).map((i) => i.id)
  const payments = invoiceIds.length
    ? unwrap(await admin.from('payments').select('amount_cents, method, invoice_id').in('invoice_id', invoiceIds))
    : []
  // What the charge SAYS it is for, which is stored and ends up on a factura.
  const lineItems = invoiceIds.length
    ? unwrap(await admin.from('invoice_line_items').select('description, quantity, price_cents, service_id, package_purchase_id').in('invoice_id', invoiceIds))
    : []
  return { purchase, appointments, invoices, credits, payments, sessions, lineItems }
}

/**
 * Tries to write a SECOND bono session against an appointment that already
 * has one, the way a double click did before
 * package_sessions_one_per_appointment existed. Returns the database's
 * refusal rather than throwing, so a spec can assert on it.
 *
 * This is the half no UI test can reach: the screen stops offering the button
 * once a session is taken, so the only way to prove the rule actually holds --
 * for the mobile app, for a race, for whatever is written next -- is to
 * attempt the write directly.
 */
async function insertDuplicateSession(opts: { accountId: string; patientId: string; packagePurchaseId: string; appointmentId: string; amountCents: number }) {
  const { error } = await admin.from('package_sessions').insert({
    account_id: opts.accountId,
    patient_id: opts.patientId,
    package_purchase_id: opts.packagePurchaseId,
    appointment_id: opts.appointmentId,
    amount_cents: opts.amountCents,
    used_at: new Date().toISOString(),
  })
  return { rejected: !!error, message: error?.message ?? null }
}

/**
 * Draws one session of a bono against an appointment -- what the app does
 * when a visit is logged to a pack. It is the case an invoice-shaped read
 * of the data gets wrong: no invoice, no payment, no document, yet the visit
 * is paid for.
 */
async function usePackageSession(opts: {
  accountId: string
  patientId: string
  packagePurchaseId: string
  appointmentId: string
  amountCents: number
  externalReference?: string
}) {
  const row = unwrap(
    await admin
      .from('package_sessions')
      .insert({
        account_id: opts.accountId,
        patient_id: opts.patientId,
        package_purchase_id: opts.packagePurchaseId,
        appointment_id: opts.appointmentId,
        amount_cents: opts.amountCents,
        used_at: new Date().toISOString(),
        ...(opts.externalReference ? { external_reference: opts.externalReference } : {}),
      })
      .select('id')
      .single(),
  )
  // The pack's own counter is what the UI reads for "n of m left".
  const purchase = unwrap(await admin.from('package_purchases').select('sessions_used').eq('id', opts.packagePurchaseId).single())
  await admin
    .from('package_purchases')
    .update({ sessions_used: ((purchase as { sessions_used: number }).sessions_used ?? 0) + 1 })
    .eq('id', opts.packagePurchaseId)
  return row as { id: string }
}

/** The patient row itself, for assertions the UI does not display. */
async function patientByName(opts: { accountId: string; firstName: string; lastName: string }) {
  const { data } = await admin
    .from('patients')
    .select('id, first_name, last_name, default_practitioner_id')
    .eq('account_id', opts.accountId)
    .eq('first_name', opts.firstName)
    .eq('last_name', opts.lastName)
    .maybeSingle()
  return data ?? null
}

async function createWhatsappMessage(opts: {
  accountId: string
  patientId?: string
  phoneNumber?: string
  direction: 'inbound' | 'outbound'
  bodyPreview?: string
  /** Delivery state. Defaults to what the direction implies; set it to
   *  exercise the thread's sent / delivered / read / failed treatments. */
  status?: string
  errorMessage?: string
  errorCode?: string
  templateName?: string
  /** ISO timestamp, so a thread can be seeded in a deliberate order. */
  createdAt?: string
}) {
  const { accountId, patientId, phoneNumber, direction, bodyPreview } = opts
  const row = unwrap(
    await admin
      .from('whatsapp_messages')
      .insert({
        account_id: accountId,
        patient_id: patientId ?? null,
        phone_number: phoneNumber ?? null,
        direction,
        status: opts.status ?? (direction === 'inbound' ? 'received' : 'sent'),
        body_preview: bodyPreview ?? 'Test message',
        ...(opts.errorMessage ? { error_message: opts.errorMessage } : {}),
        ...(opts.errorCode ? { error_code: opts.errorCode } : {}),
        ...(opts.templateName ? { template_name: opts.templateName } : {}),
        ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
      })
      .select('id, channel')
      .single(),
  )
  return row as { id: string; channel: string }
}

// Sets up the exact shape a Meta reply webhook arrives into: an account
// reachable by phone_number_id, a patient whose contact number matches the
// sender, a booked appointment, and the outbound reminder that anchors a
// reply to it. Returns the appointment so a spec can assert what the reply
// did to its confirmation_status.
async function seedWhatsappReplyScenario(opts: {
  accountId: string
  clinicId: string
  patientId: string
  phoneNumberId: string
  phone: string
  confirmationStatus?: 'pending' | 'confirmed' | 'reschedule_requested' | null
}) {
  const { accountId, clinicId, patientId, phoneNumberId, phone, confirmationStatus } = opts

  unwrap(await admin.from('accounts').update({ whatsapp_phone_number_id: phoneNumberId }).eq('id', accountId).select('id').single())

  unwrap(
    await admin
      .from('patient_contact_numbers')
      .insert({ account_id: accountId, patient_id: patientId, country_code: 'ES', number: phone, is_whatsapp: true })
      .select('id')
      .single(),
  )

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000)
  const appointment = unwrap(
    await admin
      .from('appointments')
      .insert({
        account_id: accountId,
        clinic_id: clinicId,
        patient_id: patientId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'booked',
        confirmation_status: confirmationStatus ?? null,
      })
      .select('id')
      .single(),
  )

  // The anchor: resolveRepliedAppointment follows the most recent outbound
  // message carrying an appointment_id, which is what a reminder looks like.
  unwrap(
    await admin
      .from('whatsapp_messages')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        appointment_id: (appointment as { id: string }).id,
        phone_number: phone,
        direction: 'outbound',
        purpose: 'confirmation',
        status: 'delivered',
      })
      .select('id')
      .single(),
  )

  return appointment as { id: string }
}

// Proof that the webhook actually reached this account and processed the
// message -- every inbound message is stored before any intent is applied.
// A test asserting a status STAYED put passes just as happily when the
// endpoint silently no-opped, so the negative cases check this too.
async function inboundMessages(opts: { patientId: string }) {
  const rows = unwrap(
    await admin.from('whatsapp_messages').select('id, body_preview').eq('patient_id', opts.patientId).eq('direction', 'inbound'),
  )
  return rows as { id: string; body_preview: string | null }[]
}

// Stores an app secret for the signature path, and mints an api_token for the
// forwarder path, so a spec can exercise both ways a webhook proves itself.
async function setWhatsappAppSecret(opts: { accountId: string; appSecret: string }) {
  unwrap(
    await admin
      .from('whatsapp_app_secrets')
      .upsert({ account_id: opts.accountId, app_secret: opts.appSecret }, { onConflict: 'account_id' })
      .select('account_id')
      .single(),
  )
  return { configured: true }
}

async function createApiToken(opts: { accountId: string; scopes: string[] }) {
  // Same hash the server re-derives on every request (sha256 of the raw
  // token), so the spec can hold the raw value and the database only the hash.
  const raw = `qf_live_${randomUUID().replace(/-/g, '')}`
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const row = unwrap(
    await admin
      .from('api_tokens')
      .insert({
        account_id: opts.accountId,
        name: 'cypress',
        token_hash: tokenHash,
        // Shown in the developer portal so a token is recognisable without
        // storing it; not null, so the insert needs it.
        token_prefix: raw.slice(0, 16),
        scopes: opts.scopes,
      })
      .select('id')
      .single(),
  )
  return { id: (row as { id: string }).id, token: raw }
}

// Meta's signature over the exact bytes a spec is about to send. Done here in
// Node rather than in the browser so the spec can post a pre-serialised string
// and know the digest covers precisely those bytes.
/** A stored WhatsApp token, so a spec can drive the endpoints that need one. */
async function setAccountWhatsappToken(opts: { accountId: string; token: string }) {
  unwrap(await admin.from('accounts').update({ whatsapp_access_token: opts.token }).eq('id', opts.accountId).select('id').single())
  return { stored: true }
}

/** Puts an account in the state a finished Embedded Signup leaves it in. */
async function setWhatsappBusinessAccount(opts: { accountId: string; businessAccountId: string; phoneNumberId?: string }) {
  unwrap(
    await admin
      .from('accounts')
      .update({ whatsapp_business_account_id: opts.businessAccountId, whatsapp_phone_number_id: opts.phoneNumberId ?? `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}` })
      .eq('id', opts.accountId)
      .select('id')
      .single(),
  )
  return { connected: true }
}

/**
 * The WhatsApp connection fields on an account, for asserting that a refused
 * connect attempt wrote nothing. Read with the service role deliberately: a
 * spec checking "no token was stored" must not be satisfied merely because
 * RLS hid one that IS there.
 */
async function accountWhatsappConnection(opts: { accountId: string }) {
  const { data } = await admin
    .from('accounts')
    .select('whatsapp_access_token, whatsapp_business_account_id, whatsapp_phone_number_id')
    .eq('id', opts.accountId)
    .maybeSingle()
  return data ?? null
}

// Stores a secret the way the server does, so a spec can then try to read it
// back the way a staff member would.
async function setAccountSecret(opts: { accountId: string; name: string; value: string }) {
  unwrap(
    await admin
      .from('account_secrets')
      .upsert({ account_id: opts.accountId, name: opts.name, value: opts.value }, { onConflict: 'account_id,name' })
      .select('account_id')
      .single(),
  )
  return { stored: true }
}

// What a signed-in staff member can actually read, using the same anon key and
// session the browser holds. This is the real attack rather than a proxy for
// it: `accounts` RLS is row-level, so before this change the same call
// returned the clinic's live Stripe secret key to any member of any role.
async function readAsStaff(opts: { email: string; password: string; table: string; columns?: string }) {
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email: opts.email, password: opts.password })
  if (signInErr) throw signInErr

  const { data, error } = await userClient.from(opts.table as never).select(opts.columns ?? '*')
  return { rows: (data as unknown[] | null)?.length ?? 0, error: error ? error.message : null }
}

async function clearWhatsappAppSecret(opts: { accountId: string }) {
  assertOk(await admin.from('whatsapp_app_secrets').delete().eq('account_id', opts.accountId))
  return { configured: false }
}

async function signWhatsappBody(opts: { body: string; appSecret: string }) {
  return { signature: `sha256=${createHmac('sha256', opts.appSecret).update(Buffer.from(opts.body, 'utf8')).digest('hex')}` }
}

async function appointmentById(opts: { appointmentId: string }) {
  const row = unwrap(
    await admin.from('appointments').select('id, status, confirmation_status, rescheduled').eq('id', opts.appointmentId).single(),
  )
  return row as { id: string; status: string; confirmation_status: string | null; rescheduled: boolean }
}

/**
 * Books an appointment straight into the table, skipping the UI entirely.
 * `practitionerId` is deliberately optional: an appointment with none at all
 * is a state the product really produces -- a PracticeHub import whose
 * "Practitioner" column matched no team member, or a public-API booking that
 * omitted one -- and there is no way to seed it through the calendar's own
 * form now that the form adopts the open tab's practitioner.
 */
async function createAppointment(opts: {
  accountId: string
  clinicId: string
  patientId: string
  startsAt: string
  durationMinutes?: number
  practitionerId?: string | null
  status?: string
  /** Arrived and with the practitioner, but not checked out yet. */
  checkedIn?: boolean
}) {
  const startsAt = new Date(opts.startsAt)
  const endsAt = new Date(startsAt.getTime() + (opts.durationMinutes ?? 30) * 60000)
  const appointment = unwrap(
    await admin
      .from('appointments')
      .insert({
        account_id: opts.accountId,
        clinic_id: opts.clinicId,
        patient_id: opts.patientId,
        practitioner_id: opts.practitionerId ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: opts.status ?? 'booked',
        ...(opts.checkedIn ? { checked_in_at: startsAt.toISOString(), flow_with_practitioner_at: startsAt.toISOString() } : {}),
      })
      .select('id, practitioner_id')
      .single(),
  )
  return appointment as { id: string; practitioner_id: string | null }
}

/** Seeds a lead, optionally with timeline entries and attribution. */
async function createLead(opts: {
  accountId: string
  fullName: string
  stage?: string
  channel?: string
  source?: string
  phone?: string
  email?: string
  estimatedValueCents?: number | null
  aiHandling?: boolean
  reference?: string
  /** Backdates stage_changed_at, so "time in stage" can be asserted. */
  stageChangedAt?: string
  /** Backdates created_at, for the dashboard's stale-lead and cohort maths. */
  createdAt?: string
  events?: { kind: string; title: string; detail?: string; body?: unknown; occurredAt?: string }[]
  attribution?: { campaign?: string; ad?: string; audience?: string; firstTouch?: string; lastTouch?: string; costCents?: number }
}) {
  const lead = unwrap(
    await admin
      .from('leads')
      .insert({
        account_id: opts.accountId,
        reference: opts.reference ?? `LEAD-TEST-${randomUUID().slice(0, 8)}`,
        full_name: opts.fullName,
        phone: opts.phone ?? null,
        email: opts.email ?? null,
        stage: opts.stage ?? 'new',
        channel: opts.channel ?? 'whatsapp',
        source: opts.source ?? null,
        estimated_value_cents: opts.estimatedValueCents === undefined ? 100500 : opts.estimatedValueCents,
        ai_handling: opts.aiHandling ?? false,
      })
      .select('id, reference')
      .single(),
  )

  // Set after insert rather than in it: the leads_touch_updated_at trigger
  // only fires on UPDATE, so an insert cannot be backdated through it, and a
  // backdated stage_changed_at is what makes "2 d in stage" testable.
  if (opts.stageChangedAt || opts.createdAt) {
    assertOk(
      await admin
        .from('leads')
        .update({
          ...(opts.stageChangedAt ? { stage_changed_at: opts.stageChangedAt } : {}),
          ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
        })
        .eq('id', lead.id),
    )
  }

  for (const event of opts.events ?? []) {
    assertOk(
      await admin.from('lead_events').insert({
        account_id: opts.accountId,
        lead_id: lead.id,
        kind: event.kind,
        title: event.title,
        detail: event.detail ?? null,
        body: (event.body ?? null) as never,
        occurred_at: event.occurredAt ?? new Date().toISOString(),
      }),
    )
  }

  if (opts.attribution) {
    assertOk(
      await admin.from('lead_attribution').insert({
        account_id: opts.accountId,
        lead_id: lead.id,
        campaign: opts.attribution.campaign ?? null,
        ad: opts.attribution.ad ?? null,
        audience: opts.attribution.audience ?? null,
        first_touch: opts.attribution.firstTouch ?? null,
        last_touch: opts.attribution.lastTouch ?? null,
        cost_cents: opts.attribution.costCents ?? null,
      }),
    )
  }

  return lead as { id: string; reference: string }
}

/** Reads a lead back, for asserting a PATCH actually persisted. */
async function leadById(opts: { id: string }) {
  const { data } = await admin.from('leads').select('*').eq('id', opts.id).maybeSingle()
  return data
}

/** The timeline the API wrote, for asserting a stage change was recorded. */
async function leadEvents(opts: { leadId: string }) {
  const { data } = await admin.from('lead_events').select('*').eq('lead_id', opts.leadId).order('occurred_at')
  return data ?? []
}

/** A patient plus the contact-number rows that drive has_phone. */
async function patientWithContacts(opts: { id: string }) {
  const { data: patient } = await admin
    .from('patients')
    .select('id, first_name, last_name, email, referral_source, has_phone, clinic_id')
    .eq('id', opts.id)
    .maybeSingle()
  const { data: numbers } = await admin.from('patient_contact_numbers').select('number, is_whatsapp').eq('patient_id', opts.id)
  return { patient, numbers: numbers ?? [] }
}

/** How many patients this account has, for asserting nothing was duplicated. */
async function patientCount(opts: { accountId: string }) {
  const { count } = await admin.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', opts.accountId)
  return count ?? 0
}

/** A WhatsApp message attached to a lead's thread. */
async function createLeadMessage(opts: {
  accountId: string
  leadId: string
  direction: 'inbound' | 'outbound'
  body: string
  createdAt?: string
  status?: string
}) {
  const row = unwrap(
    await admin
      .from('whatsapp_messages')
      .insert({
        account_id: opts.accountId,
        lead_id: opts.leadId,
        direction: opts.direction,
        body_preview: opts.body,
        status: opts.status ?? (opts.direction === 'inbound' ? 'received' : 'sent'),
        channel: 'whatsapp',
      })
      .select('id')
      .single(),
  )
  // created_at has a default, so backdating needs a second statement --
  // which is what makes the 24h window testable.
  if (opts.createdAt) {
    assertOk(await admin.from('whatsapp_messages').update({ created_at: opts.createdAt }).eq('id', row.id))
  }
  return row as { id: string }
}

/** Reads a lead's AI state back, for asserting a take-over persisted. */
async function leadAiState(opts: { id: string }) {
  const { data } = await admin.from('leads').select('ai_state, ai_handling, ai_taken_over_by').eq('id', opts.id).maybeSingle()
  return data
}

/** Adds or removes the Growth add-on, which every Growth route now checks. */
async function setGrowthAddon(opts: { accountId: string; enabled: boolean }) {
  assertOk(await admin.from('subscriptions').update({ growth_addon: opts.enabled }).eq('account_id', opts.accountId))
  return { ok: true }
}

/**
 * Puts an account on a plan and billing interval.
 *
 * Needed because two things now depend on the plan rather than on a flag:
 * Clinic includes Growth (utils/growthPlans.ts), and an annual subscription's
 * next charge is twelve months at once.
 */
async function setSubscriptionPlan(opts: { accountId: string; planId: string; interval?: 'monthly' | 'annual' }) {
  assertOk(
    await admin
      .from('subscriptions')
      .update({ plan_id: opts.planId, ...(opts.interval ? { billing_interval: opts.interval } : {}) })
      .eq('account_id', opts.accountId),
  )
  return { ok: true }
}

/** Sets a lead's ai_state directly, to stand in for a person taking over. */
async function setLeadAiState(opts: { id: string; aiState: string }) {
  assertOk(await admin.from('leads').update({ ai_state: opts.aiState }).eq('id', opts.id))
  return { ok: true }
}

/** Points an account at a WhatsApp number, which is how the webhook finds it. */
async function setWhatsappPhoneNumberId(opts: { accountId: string; phoneNumberId: string }) {
  assertOk(await admin.from('accounts').update({ whatsapp_phone_number_id: opts.phoneNumberId }).eq('id', opts.accountId))
  return { ok: true }
}

/** The lead an Instagram sender became, for asserting it was created once. */
async function leadsByExternalId(opts: { accountId: string; externalSource: string }) {
  const { data } = await admin
    .from('leads')
    .select('id, full_name, channel, source, stage, external_id, external_source, phone, marketing_consent_at')
    .eq('account_id', opts.accountId)
    .eq('external_source', opts.externalSource)
    .is('deleted_at', null)
  return data ?? []
}

/** Connects an Instagram account, the way Settings > WhatsApp does. */
async function setInstagramAccount(opts: { accountId: string; instagramUserId: string | null; accessToken?: string | null }) {
  assertOk(
    await admin
      .from('accounts')
      .update({
        instagram_user_id: opts.instagramUserId,
        instagram_access_token: opts.accessToken === undefined ? 'ig-test-token' : opts.accessToken,
      })
      .eq('id', opts.accountId),
  )
  return { ok: true }
}

/** Every message stored on a channel, for asserting what a webhook did. */
async function messagesOnChannel(opts: { accountId: string; channel: string }) {
  const { data } = await admin
    .from('whatsapp_messages')
    .select('direction, status, body_preview, external_contact_id, wamid, channel, lead_id')
    .eq('account_id', opts.accountId)
    .eq('channel', opts.channel)
    .order('created_at')
  return data ?? []
}

/** Records ad spend for a channel in the current month. */
async function setChannelSpend(opts: { accountId: string; channel: string; amountCents: number; month?: string }) {
  const month = opts.month ?? new Date().toISOString().slice(0, 8) + '01'
  assertOk(
    await admin.from('channel_spend').upsert(
      { account_id: opts.accountId, channel: opts.channel, period_month: month, amount_cents: opts.amountCents },
      { onConflict: 'account_id,channel,period_month' },
    ),
  )
  return { channel: opts.channel, month }
}

/** Seeds a review, as a platform importer or a hand-entry would. */
async function createReview(opts: {
  accountId: string
  authorName: string
  rating: number
  body?: string
  platform?: string
  postedAt?: string
  draftBody?: string
  repliedAt?: string
  replyBody?: string
  replyWasAiDrafted?: boolean
}) {
  return unwrap(
    await admin
      .from('reviews')
      .insert({
        account_id: opts.accountId,
        platform: opts.platform ?? 'google',
        author_name: opts.authorName,
        rating: opts.rating,
        body: opts.body ?? null,
        posted_at: opts.postedAt ?? new Date().toISOString(),
        draft_body: opts.draftBody ?? null,
        draft_created_at: opts.draftBody ? new Date().toISOString() : null,
        replied_at: opts.repliedAt ?? null,
        reply_body: opts.replyBody ?? null,
        reply_was_ai_drafted: opts.replyWasAiDrafted ?? false,
      })
      .select('id')
      .single(),
  )
}

/** Seeds a review request, optionally already opened or already attributed. */
async function createReviewRequest(opts: { accountId: string; token: string; openedAt?: string; reviewId?: string }) {
  return unwrap(
    await admin
      .from('review_requests')
      .insert({
        account_id: opts.accountId,
        token: opts.token,
        opened_at: opts.openedAt ?? null,
        review_id: opts.reviewId ?? null,
      })
      .select('id, token')
      .single(),
  )
}

/** Reads a review back, to check what an approval actually wrote. */
async function reviewById(opts: { id: string }) {
  return unwrap(await admin.from('reviews').select('*').eq('id', opts.id).single())
}

/** Reads a request back, to check the redirect recorded the open. */
async function reviewRequestByToken(opts: { token: string }) {
  return unwrap(await admin.from('review_requests').select('*').eq('token', opts.token).single())
}

/** Points the account's review link somewhere, as the settings screen will. */
async function setGoogleReviewUrl(opts: { accountId: string; url: string | null }) {
  assertOk(await admin.from('accounts').update({ google_review_url: opts.url }).eq('id', opts.accountId))
  return { url: opts.url }
}

/** An automation rule plus its ordered actions, for sequence tests. */
async function createAutomationRule(opts: {
  accountId: string
  triggerEvent: string
  /** Defaults to the old hardcoded value, for the sequence specs that predate this. */
  name?: string
  isMarketing?: boolean
  enabled?: boolean
  dryRun?: boolean
  actions: { type: string; config?: Record<string, unknown> }[]
}) {
  const rule = unwrap(
    await admin
      .from('automation_rules')
      .insert({
        account_id: opts.accountId,
        name: opts.name ?? 'cypress sequence',
        trigger_event: opts.triggerEvent,
        enabled: opts.enabled ?? true,
        is_marketing: opts.isMarketing ?? false,
        dry_run: opts.dryRun ?? false,
      })
      .select('id')
      .single(),
  )
  const ruleId = (rule as { id: string }).id

  if (opts.actions.length > 0) {
    assertOk(
      await admin.from('automation_actions').insert(
        opts.actions.map((a, i) => ({
          account_id: opts.accountId,
          rule_id: ruleId,
          action_type: a.type,
          position: i,
          config: a.config ?? {},
        })),
      ),
    )
  }
  return { id: ruleId }
}

/** Review requests for an account, for asserting what was and was not counted. */
async function reviewRequestsFor(opts: { accountId: string }) {
  const { data } = await admin
    .from('review_requests')
    .select('token, patient_id, appointment_id, opened_at, review_id')
    .eq('account_id', opts.accountId)
    .order('sent_at')
  return data ?? []
}

/** The most recently created rule's actions, for builder round-trip tests. */
// Every rule with its actions, for a spec that creates several at once --
// latestAutomationActions answers for the newest rule only, which cannot say
// whether the OTHER templates were created or left alone.
//
// accountId is REQUIRED, unlike its neighbour. CI runs ten growth specs
// against one database, so an unscoped query here returned the 14 rules the
// other nine had created alongside the 2 under test -- and passed locally,
// where the spec ran alone against a fresh reset. Taking only the newest row
// is what hides that in latestAutomationActions; counting rows cannot.
// --- Email delivery metrics ------------------------------------------------

/**
 * A sent email in whatever delivery state the spec needs.
 *
 * Seeded rather than sent, because the alternative is a real Resend call: the
 * key is send-only, the account is the clinic's own, and a test that emails
 * somebody every time it runs is not a test.
 */
async function seedEmailMessage(opts: {
  providerMessageId: string
  accountId?: string
  ruleId?: string
  delivered?: boolean
  openCount?: number
  clicked?: boolean
  bounced?: boolean
  failed?: boolean
  /** Attaches the email to a patient, so it joins their conversation. */
  patientId?: string
  recipientEmail?: string
  subject?: string
}) {
  let accountId = opts.accountId
  if (!accountId) {
    const acc = unwrap(await admin.from('accounts').select('id').order('created_at').limit(1).single())
    accountId = (acc as { id: string }).id
  }
  const now = new Date().toISOString()
  const row = unwrap(
    await admin
      .from('email_messages')
      .insert({
        account_id: accountId,
        provider_message_id: opts.providerMessageId,
        rule_id: opts.ruleId ?? null,
        patient_id: opts.patientId ?? null,
        recipient_email: opts.recipientEmail ?? `seed-${Date.now()}@example.test`,
        subject: opts.subject ?? 'Seeded',
        sent_at: now,
        delivered_at: opts.delivered || opts.openCount || opts.clicked ? now : null,
        first_opened_at: opts.openCount ? now : null,
        open_count: opts.openCount ?? 0,
        first_clicked_at: opts.clicked ? now : null,
        click_count: opts.clicked ? 1 : 0,
        bounced_at: opts.bounced ? now : null,
        failed_at: opts.failed ? now : null,
      })
      .select('id, provider_message_id')
      .single(),
  )
  return row as { id: string; provider_message_id: string }
}

async function emailMessage(opts: { providerMessageId: string }) {
  const { data, error } = await admin
    .from('email_messages')
    .select('provider_message_id, delivered_at, first_opened_at, open_count, first_clicked_at, click_count, bounced_at, failed_at')
    .eq('provider_message_id', opts.providerMessageId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Svix headers for a body, so a spec can post a genuinely signed event.
 *
 * The secret defaults to the one the dev server runs with. Signing here rather
 * than in the spec keeps the scheme in one place -- and a spec that computed
 * its own digest would pass against a verifier that checked nothing.
 */
async function signResendWebhook(opts: { body: string; secret?: string }) {
  const { createHmac } = await import('node:crypto')
  const secret = opts.secret ?? process.env.CYPRESS_RESEND_WEBHOOK_SECRET ?? process.env.NUXT_RESEND_WEBHOOK_SECRET ?? 'whsec_dGVzdC1zZWNyZXQtZm9yLWN5cHJlc3M='
  const id = `msg_${Date.now()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${opts.body}`).digest('base64')
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }
}

async function latestAutomationRules(opts: { accountId: string }) {
  const { data: rules } = await admin
    .from('automation_rules')
    .select('id, name, trigger_event, enabled, is_marketing, filters')
    .eq('account_id', opts.accountId)
    .order('created_at')
  const out = []
  for (const rule of (rules ?? []) as { id: string }[]) {
    const { data: actions } = await admin
      .from('automation_actions')
      .select('action_type, position, config')
      .eq('rule_id', rule.id)
      .order('position')
    out.push({ ...rule, actions: actions ?? [] })
  }
  return out
}

// accountId is required for the same reason it is on latestAutomationRules:
// CI runs eleven growth specs against one database, so "the newest rule" is
// only this spec's rule by luck of ordering. It held until a shard run under
// load returned a neighbouring spec's rule instead, and the failure read as
// "the delay was not saved" -- which it had been.
async function latestAutomationActions(opts: { accountId: string }) {
  const { data: rule } = await admin
    .from('automation_rules')
    .select('id')
    .eq('account_id', opts.accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!rule) return []
  const { data } = await admin
    .from('automation_actions')
    .select('action_type, position, config')
    .eq('rule_id', (rule as { id: string }).id)
    .order('position')
  return data ?? []
}

/** Messages recorded against a lead, for asserting a dry run wrote instead of sent. */
async function leadMessages(opts: { leadId: string }) {
  const { data } = await admin
    .from('whatsapp_messages')
    .select('status, template_name, phone_number, wamid')
    .eq('lead_id', opts.leadId)
    .order('created_at')
  return data ?? []
}

// A stand-in for PracticeHub's /api/patients, so a spec can choose what it
// answers. The real call is server-to-server from the Nuxt process, which
// cy.intercept cannot see -- and the answer is the whole point of the check,
// so "unreachable" and "not configured" were the only cases testable without
// this.
// A stand-in for Meta's Graph API on a FIXED port, because unlike the
// PracticeHub stub below -- whose URL is stored per account and can therefore
// be a random port -- the Graph base URL is one global setting the Nuxt server
// reads at startup. So the port has to be known before the server boots, and
// e2e.yml passes it as NUXT_META_GRAPH_BASE_URL.
//
// This exists because /api/meta/connect/callback spends an authorization code
// and writes an access token onto an account. Testing that against the real
// Graph API would mean live calls to Meta from CI; testing it not at all would
// leave the one endpoint that stores a credential unexercised.
const META_GRAPH_STUB_PORT = 9147
let metaGraphStub: import('node:http').Server | null = null

async function startMetaGraphStub(opts: {
  /** Which step should fail, to prove a half-connection is never stored. */
  failAt?: 'exchange' | 'debug' | 'phones' | 'subscribe' | 'templates'
  wabaId?: string
  phoneNumberId?: string
  displayPhoneNumber?: string
  /** Scopes granted, so a connection with no WABA on it can be simulated. */
  scope?: string
}) {
  await stopMetaGraphStub()
  const { createServer } = await import('node:http')

  const wabaId = opts.wabaId ?? '102290129340398'
  const phoneNumberId = opts.phoneNumberId ?? '387933511072949'
  const seen: string[] = []

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    seen.push(`${req.method} ${path}`)
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const refuse = (message: string) => send(400, { error: { message } })

    if (path.endsWith('/oauth/access_token')) {
      if (opts.failAt === 'exchange') return refuse('This authorization code has been used.')
      return send(200, { access_token: 'STUB-BUSINESS-TOKEN' })
    }
    if (path.endsWith('/debug_token')) {
      if (opts.failAt === 'debug') return refuse('Invalid OAuth access token.')
      return send(200, {
        data: { granular_scopes: [{ scope: opts.scope ?? 'whatsapp_business_management', target_ids: opts.scope === 'none' ? [] : [wabaId] }] },
      })
    }
    if (path.endsWith('/message_templates')) {
      // The error branch is the point: an expired token and a wrong Business
      // Account ID both land here, and the endpoint used to describe neither.
      if (opts.failAt === 'templates') {
        return send(401, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190 } })
      }
      return send(200, {
        data: [
          {
            name: 'recordatorio_cita',
            language: 'es',
            category: 'UTILITY',
            status: 'APPROVED',
            components: [{ type: 'BODY', text: 'Hola {{1}}, te recordamos tu cita el {{2}}.' }],
          },
        ],
      })
    }
    if (path.endsWith('/phone_numbers')) {
      if (opts.failAt === 'phones') return refuse('Unsupported get request.')
      return send(200, { data: [{ id: phoneNumberId, display_phone_number: opts.displayPhoneNumber ?? '+34 960 05 40 40' }] })
    }
    if (path.endsWith('/subscribed_apps')) {
      if (opts.failAt === 'subscribe') return refuse('Application does not have permission for this action.')
      return send(200, { success: true })
    }
    return send(404, { error: { message: `stub has no route for ${path}` } })
  })

  await new Promise<void>((resolve) => server.listen(META_GRAPH_STUB_PORT, '127.0.0.1', () => resolve()))
  metaGraphStub = server
  return { baseUrl: `http://127.0.0.1:${META_GRAPH_STUB_PORT}`, seen }
}

async function stopMetaGraphStub() {
  const server = metaGraphStub
  metaGraphStub = null
  if (!server) return { ok: true }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return { ok: true }
}

let practiceHubStub: import('node:http').Server | null = null

async function startPracticeHubStub(opts: { totalEntries?: number; emails?: string[] }) {
  await stopPracticeHubStub()
  const { createServer } = await import('node:http')
  const emails = opts.emails ?? []
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        total_entries: opts.totalEntries ?? emails.length,
        data: emails.map((email, i) => ({ id: i + 1, email })),
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  practiceHubStub = server
  const port = (server.address() as { port: number }).port
  return { baseUrl: `http://127.0.0.1:${port}` }
}

async function stopPracticeHubStub() {
  const server = practiceHubStub
  practiceHubStub = null
  if (!server) return { ok: true }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return { ok: true }
}

/** How far the receptionist has already drafted, for the no-redraft guard. */
async function setLeadDraftedThrough(opts: { id: string; at: string | null }) {
  assertOk(await admin.from('leads').update({ ai_drafted_through_at: opts.at }).eq('id', opts.id))
  return { ok: true }
}

/** Turns the receptionist on or off, the way Growth > Receptionist does. */
async function setReceptionistEnabled(opts: { accountId: string; enabled: boolean }) {
  assertOk(
    await admin
      .from('receptionist_config')
      .upsert({ account_id: opts.accountId, enabled: opts.enabled }, { onConflict: 'account_id' }),
  )
  return { ok: true }
}

/** Puts a receptionist draft on a lead, the way the drafting route would. */
async function setLeadDraft(opts: { id: string; body: string | null }) {
  assertOk(
    await admin
      .from('leads')
      .update({ ai_draft_body: opts.body, ai_draft_created_at: opts.body ? new Date().toISOString() : null })
      .eq('id', opts.id),
  )
  return { ok: true }
}

/** Reads back what survived an approve or a discard. */
async function leadDraft(opts: { id: string }) {
  const { data } = await admin.from('leads').select('ai_draft_body, ai_draft_created_at').eq('id', opts.id).maybeSingle()
  return data
}

/** Turns on the new-lead staff notification, to exercise its wiring. */
async function setNewLeadNotify(opts: { accountId: string; email?: string | null; whatsapp?: string | null }) {
  assertOk(
    await admin
      .from('accounts')
      .update({
        new_lead_notify_email: opts.email ?? null,
        new_lead_notify_whatsapp: opts.whatsapp ?? null,
      })
      .eq('id', opts.accountId),
  )
  return { ok: true }
}

/** Gives an account PracticeHub credentials, to exercise the external check. */
async function setPracticeHubConnection(opts: { accountId: string; baseUrl: string | null; apiKey?: string | null }) {
  assertOk(
    await admin
      .from('accounts')
      .update({
        practicehub_base_url: opts.baseUrl,
        practicehub_api_key: opts.apiKey === undefined ? 'test-key' : opts.apiKey,
        practicehub_contact_email: 'cypress@example.com',
      })
      .eq('id', opts.accountId),
  )
  return { ok: true }
}

/** Moves a lead's stage without a staff session, for specs about other things. */
async function setLeadStage(opts: { id: string; stage: string }) {
  assertOk(await admin.from('leads').update({ stage: opts.stage }).eq('id', opts.id))
  return { ok: true }
}

/** Where a lead has got to in a sequence, for asserting it stopped. */
async function sequenceRuns(opts: { leadId: string }) {
  const { data } = await admin.from('automation_sequence_runs').select('*').eq('lead_id', opts.leadId)
  return data ?? []
}

/** Pulls a run's resume_at back so the cron sees it as due. */
async function makeSequenceDue(opts: { leadId: string }) {
  assertOk(
    await admin
      .from('automation_sequence_runs')
      .update({ resume_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('lead_id', opts.leadId),
  )
  return { ok: true }
}

export const dbTasks = {
  'db:createStaffAccount': createStaffAccount,
  'db:createLead': createLead,
  'db:createLeadMessage': createLeadMessage,
  'db:leadAiState': leadAiState,
  'db:setGrowthAddon': setGrowthAddon,
  'db:setSubscriptionPlan': setSubscriptionPlan,
  'db:setLeadAiState': setLeadAiState,
  'db:setWhatsappPhoneNumberId': setWhatsappPhoneNumberId,
  'db:leadsByExternalId': leadsByExternalId,
  'db:setInstagramAccount': setInstagramAccount,
  'db:messagesOnChannel': messagesOnChannel,
  'db:setChannelSpend': setChannelSpend,
  'db:reviewRequestsFor': reviewRequestsFor,
  'db:latestAutomationActions': latestAutomationActions,
  'db:latestAutomationRules': latestAutomationRules,
  'db:seedEmailMessage': seedEmailMessage,
  'db:emailMessage': emailMessage,
  'db:signResendWebhook': signResendWebhook,
  'db:createAutomationRule': createAutomationRule,
  'db:leadMessages': leadMessages,
  'db:setLeadDraftedThrough': setLeadDraftedThrough,
  'db:setReceptionistEnabled': setReceptionistEnabled,
  'db:setLeadDraft': setLeadDraft,
  'db:leadDraft': leadDraft,
  'db:setNewLeadNotify': setNewLeadNotify,
  'db:setPracticeHubConnection': setPracticeHubConnection,
  'db:startPracticeHubStub': startPracticeHubStub,
  'db:stopPracticeHubStub': stopPracticeHubStub,
  'db:setLeadStage': setLeadStage,
  'db:sequenceRuns': sequenceRuns,
  'db:makeSequenceDue': makeSequenceDue,
  'db:createReview': createReview,
  'db:createReviewRequest': createReviewRequest,
  'db:reviewById': reviewById,
  'db:reviewRequestByToken': reviewRequestByToken,
  'db:setGoogleReviewUrl': setGoogleReviewUrl,
  'db:patientWithContacts': patientWithContacts,
  'db:patientCount': patientCount,
  'db:leadById': leadById,
  'db:leadEvents': leadEvents,
  'db:createTeamMemberWithRole': createTeamMemberWithRole,
  'db:setRolePermissions': setRolePermissions,
  'db:setSubscriptionStatus': setSubscriptionStatus,
  'db:setComped': setComped,
  'db:setExtraProfessionals': setExtraProfessionals,
  'db:setSubscriptionStripeIds': setSubscriptionStripeIds,
  'db:createPatient': createPatient,
  'db:createPatientDoc': createPatientDoc,
  'db:patientByName': patientByName,
  'db:createAppointmentType': createAppointmentType,
  'db:createServiceProduct': createServiceProduct,
  'db:enableOnlineBooking': enableOnlineBooking,
  'db:enableEmailConfirmations': enableEmailConfirmations,
  'db:createInvoice': createInvoice,
  'db:createPayment': createPayment,
  'db:nextInvoiceNumber': nextInvoiceNumber,
  'db:deleteInvoice': deleteInvoice,
  'db:paymentById': paymentById,
  'db:createPackageTemplate': createPackageTemplate,
  'db:createFactura': createFactura,
  'db:setPatientNif': setPatientNif,
  'db:setPatientContactFlags': setPatientContactFlags,
  'db:createAccountCredit': createAccountCredit,
  'db:paymentsFor': paymentsFor,
  'db:facturasFor': facturasFor,
  'db:createFacturaWithoutTax': createFacturaWithoutTax,
  'db:huellaFor': huellaFor,
  'db:facturaRecordsFor': facturaRecordsFor,
  'db:verifyFacturaChain': verifyFacturaChain,
  'db:awaitingAeat': awaitingAeat,
  'db:indicadorMultiplesOt': indicadorMultiplesOt,
  'db:accountCount': accountCount,
  'db:awaitingAeatAs': awaitingAeatAs,
  'db:recordAeatSubmission': recordAeatSubmission,
  'db:verifyFacturaChainAs': verifyFacturaChainAs,
  'db:rebuildFacturaHuellas': rebuildFacturaHuellas,
  'db:tryMutateFacturaRecord': tryMutateFacturaRecord,
  'db:nextFacturaNumber': nextFacturaNumber,
  'db:settleImportedInvoices': settleImportedInvoices,
  'db:invoiceById': invoiceById,
  'db:invoiceStatusByRef': invoiceStatusByRef,
  'db:createImportedInvoice': createImportedInvoice,
  'db:createImportedPayment': createImportedPayment,
  'db:createPackagePurchase': createPackagePurchase,
  'db:callPublicBookingAsAnon': callPublicBookingAsAnon,
  'db:sharePackageWith': sharePackageWith,
  'db:packageSessionEffects': packageSessionEffects,
  'db:insertDuplicateSession': insertDuplicateSession,
  'db:usePackageSession': usePackageSession,
  'db:createWhatsappMessage': createWhatsappMessage,
  'db:seedWhatsappReplyScenario': seedWhatsappReplyScenario,
  'db:createAppointment': createAppointment,
  'db:appointmentById': appointmentById,
  'db:inboundMessages': inboundMessages,
  'db:setWhatsappAppSecret': setWhatsappAppSecret,
  'db:createApiToken': createApiToken,
  'db:signWhatsappBody': signWhatsappBody,
  'db:clearWhatsappAppSecret': clearWhatsappAppSecret,
  'db:setAccountSecret': setAccountSecret,
  'db:accountWhatsappConnection': accountWhatsappConnection,
  'db:setWhatsappBusinessAccount': setWhatsappBusinessAccount,
  'db:setAccountWhatsappToken': setAccountWhatsappToken,
  'db:startMetaGraphStub': startMetaGraphStub,
  'db:stopMetaGraphStub': stopMetaGraphStub,
  'db:readAsStaff': readAsStaff,
  'db:rolePermissions': rolePermissions,
  'db:bookingAttribution': bookingAttribution,
}
