import type { H3Event } from 'h3'

// Settings that belong to the company rather than to anyone's day-to-day job:
// who the clinic is to the tax agency, and the certificate that signs for it.
// Owner only -- a role with every permission is still not the company.
export async function requireOwner(event: H3Event) {
  const { supabase, teamMember } = await requireTeamMember(event)
  if (!teamMember.is_owner) {
    throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this' })
  }
  return { supabase, teamMember }
}
