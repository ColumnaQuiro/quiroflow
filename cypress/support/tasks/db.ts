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

/** Merges a partial permissions patch into a role's permissions jsonb (for narrowing default-permissive roles). */
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

async function createPatient(opts: {
  accountId: string
  clinicId: string
  firstName: string
  lastName?: string
  email?: string
  dateOfBirth?: string
}) {
  const { accountId, clinicId, firstName, lastName, email, dateOfBirth } = opts
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
      })
      .select('id, first_name, last_name')
      .single(),
  )
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
}) {
  const { accountId, invoiceId, amountCents, method } = opts
  let patientId = opts.patientId
  if (!patientId) {
    if (!invoiceId) throw new Error('createPayment needs patientId or invoiceId')
    const inv = unwrap(await admin.from('invoices').select('patient_id').eq('id', invoiceId).single())
    patientId = (inv as { patient_id: string }).patient_id
  }
  const row = unwrap(
    await admin
      .from('payments')
      .insert({ account_id: accountId, patient_id: patientId, invoice_id: invoiceId ?? null, amount_cents: amountCents, method })
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
}) {
  const { accountId, patientId, packageName, sessionsTotal, sessionsUsed, priceCents } = opts
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
      })
      .select('id, package_name, sessions_total, sessions_used, price_cents')
      .single(),
  )
  return row as { id: string; package_name: string; sessions_total: number; sessions_used: number; price_cents: number }
}

// Reads back what "Log session" wrote, so the spec can assert the money side
// (invoice, payment, credit debit) and not just the on-screen counter.
async function packageSessionEffects(opts: { patientId: string; packagePurchaseId: string }) {
  const { patientId, packagePurchaseId } = opts
  const purchase = unwrap(await admin.from('package_purchases').select('sessions_used').eq('id', packagePurchaseId).single())
  const appointments = unwrap(await admin.from('appointments').select('id, status').eq('patient_id', patientId))
  const invoices = unwrap(await admin.from('invoices').select('id, status, total_cents, appointment_id').eq('patient_id', patientId))
  const credits = unwrap(await admin.from('account_credits').select('amount_cents, reason').eq('patient_id', patientId))
  const sessions = unwrap(
    await admin.from('package_sessions').select('amount_cents, appointment_id, package_purchase_id').eq('patient_id', patientId),
  )
  const invoiceIds = (invoices as { id: string }[]).map((i) => i.id)
  const payments = invoiceIds.length
    ? unwrap(await admin.from('payments').select('amount_cents, method, invoice_id').in('invoice_id', invoiceIds))
    : []
  return { purchase, appointments, invoices, credits, payments, sessions }
}

async function createWhatsappMessage(opts: {
  accountId: string
  patientId?: string
  phoneNumber?: string
  direction: 'inbound' | 'outbound'
  bodyPreview?: string
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
        status: direction === 'inbound' ? 'received' : 'sent',
        body_preview: bodyPreview ?? 'Test message',
      })
      .select('id, channel')
      .single(),
  )
  return row as { id: string; channel: string }
}

export const dbTasks = {
  'db:createStaffAccount': createStaffAccount,
  'db:createTeamMemberWithRole': createTeamMemberWithRole,
  'db:setRolePermissions': setRolePermissions,
  'db:setSubscriptionStatus': setSubscriptionStatus,
  'db:setComped': setComped,
  'db:setExtraProfessionals': setExtraProfessionals,
  'db:setSubscriptionStripeIds': setSubscriptionStripeIds,
  'db:createPatient': createPatient,
  'db:createAppointmentType': createAppointmentType,
  'db:createServiceProduct': createServiceProduct,
  'db:enableOnlineBooking': enableOnlineBooking,
  'db:enableEmailConfirmations': enableEmailConfirmations,
  'db:createInvoice': createInvoice,
  'db:createPayment': createPayment,
  'db:nextInvoiceNumber': nextInvoiceNumber,
  'db:deleteInvoice': deleteInvoice,
  'db:paymentById': paymentById,
  'db:settleImportedInvoices': settleImportedInvoices,
  'db:invoiceStatusByRef': invoiceStatusByRef,
  'db:createImportedInvoice': createImportedInvoice,
  'db:createImportedPayment': createImportedPayment,
  'db:createPackagePurchase': createPackagePurchase,
  'db:packageSessionEffects': packageSessionEffects,
  'db:createWhatsappMessage': createWhatsappMessage,
}
