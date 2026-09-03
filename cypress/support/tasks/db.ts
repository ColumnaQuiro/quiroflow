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
}) {
  const { accountId, clinicId, roleName, email, password, fullName } = opts

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

async function createInvoice(opts: { accountId: string; patientId: string; invoiceNumber?: string }) {
  const { accountId, patientId, invoiceNumber } = opts
  const row = unwrap(
    await admin
      .from('invoices')
      .insert({
        account_id: accountId,
        patient_id: patientId,
        invoice_number: invoiceNumber ?? `INV-${Date.now()}`,
      })
      .select('id, invoice_number')
      .single(),
  )
  return row as { id: string; invoice_number: string }
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
  'db:createPatient': createPatient,
  'db:createAppointmentType': createAppointmentType,
  'db:createServiceProduct': createServiceProduct,
  'db:enableOnlineBooking': enableOnlineBooking,
  'db:enableEmailConfirmations': enableEmailConfirmations,
  'db:createInvoice': createInvoice,
  'db:createWhatsappMessage': createWhatsappMessage,
}
