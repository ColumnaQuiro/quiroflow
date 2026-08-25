import { serverSupabaseUser } from '#supabase/server'

// "Send test to me" in the campaign editor drawer: runs the actions currently
// on screen -- saved or not -- against the signed-in team member instead of a
// real patient, so staff can preview a campaign before committing to it.
// Takes the draft action list straight from the client rather than a ruleId:
// requiring a saved rule first would mean this "just a preview" button had
// the side effect of writing a real, enabled automation_rules row (which the
// "Cancel" button would then leave orphaned in the database). Reuses
// runActionsList(), the same per-action sending logic as the trigger-based
// fire.post.ts and the one-off send-now.post.ts (see
// server/utils/runAutomationActions.ts), just fed an in-memory list instead
// of one read back from automation_actions.
//
// Team members aren't patients and have no phone number on file, so a
// whatsapp_template action's lookup in patient_contact_numbers will simply
// find nothing and no-op (see runWhatsAppAction) -- test sends only really
// exercise the email action. A WhatsApp action with a document attached will
// also fail its patient_docs insert (patient_id has a real FK to patients)
// and be swallowed by runActionsList's per-action try/catch, same as any
// other best-effort action failure.
interface SendTestBody {
  actions: { action_type: 'whatsapp_template' | 'email' | 'webhook'; config: Record<string, any> }[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SendTestBody>(event)
  if (!Array.isArray(body?.actions) || body.actions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'actions are required' })
  }

  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id

  const { data: member } = await supabase.from('team_members').select('full_name').eq('id', teamMember.id).maybeSingle()
  const user = await serverSupabaseUser(event)
  if (!user?.email) throw createError({ statusCode: 400, statusMessage: 'Your account has no email on file to send a test to.' })

  const fullName = member?.full_name?.trim() || 'Test'
  const [firstName, ...rest] = fullName.split(' ')

  const origin = getRequestURL(event).origin
  // isMarketing: false -- a deliberately-requested preview send should never
  // be blocked by a consent gate the staff member sending it already knows
  // about; the gate exists for real automated sends to real patients.
  await runActionsList(
    supabase,
    accountId,
    body.actions.map((a, i) => ({ id: `test-${i}`, action_type: a.action_type, config: a.config ?? {} })),
    { id: teamMember.id, first_name: firstName, last_name: rest.join(' ') || null, email: user.email },
    origin,
    false,
  )

  return { sent: true, email: user.email }
})
