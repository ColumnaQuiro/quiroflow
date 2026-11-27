import { serverSupabaseUser } from '#supabase/server'
import { toE164 } from '~/utils/phone'

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
// whatsapp_template action's lookup in patient_contact_numbers would simply
// find nothing and no-op (see runWhatsAppAction) -- the caller supplies a
// whatsappNumber to test against instead, passed through as an override
// that skips that lookup. A form a step attaches (a WhatsApp form button, an
// email's {{form_link}}) is not copied onto the staff member, who is not a
// patient (patient_docs.patient_id has a real FK to patients): the test
// checks the form exists and sends the example link /doc/ejemplo instead.
//
// Merge fields that need something a test does not have (the appointment's
// date and time, an invoice, a review link) are sent as example values
// rather than empty: see MergeContext.samples.
interface SendTestBody {
  actions: { action_type: 'whatsapp_template' | 'email' | 'webhook'; config: Record<string, any> }[]
  whatsappNumber?: string
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

  const hasWhatsAppAction = body.actions.some((a) => a.action_type === 'whatsapp_template')
  let whatsappNumber: string | undefined
  if (hasWhatsAppAction) {
    if (!body.whatsappNumber?.trim()) throw createError({ statusCode: 400, statusMessage: 'Enter a WhatsApp number to send the test to.' })
    whatsappNumber = toE164(body.whatsappNumber, 'ES') ?? undefined
    if (!whatsappNumber) throw createError({ statusCode: 400, statusMessage: 'That WhatsApp number looks invalid.' })
  }

  const fullName = member?.full_name?.trim() || 'Test'
  const [firstName, ...rest] = fullName.split(' ')

  const origin = getRequestURL(event).origin
  // isMarketing: false -- a deliberately-requested preview send should never
  // be blocked by a consent gate the staff member sending it already knows
  // about; the gate exists for real automated sends to real patients.
  const problems = await runActionsList(
    supabase,
    accountId,
    body.actions.map((a, i) => ({ id: `test-${i}`, action_type: a.action_type, config: a.config ?? {} })),
    { id: teamMember.id, first_name: firstName, last_name: rest.join(' ') || null, email: user.email },
    origin,
    false,
    undefined,
    undefined,
    whatsappNumber,
    // No appointment, invoice or visit stands behind a test, so the fields
    // that read one would go out empty -- and Meta refuses a template with an
    // empty parameter (#131008), failing a step that works for a real
    // patient. They go out as the editor's example values instead.
    { samples: true },
  )

  // A test that quietly sent nothing is worse than one that fails loudly:
  // staff read the tick as "email works" and go on to schedule a campaign
  // against it. runActionsList collects the reason each action did nothing --
  // an unverified sending domain, a missing key, a consent gate -- and a test
  // send reports them rather than swallowing them the way a real automated
  // send does.
  if (problems.length > 0) {
    throw createError({ statusCode: 502, statusMessage: problems.join(' ') })
  }

  const hasEmailAction = body.actions.some((a) => a.action_type === 'email')
  return { sent: true, email: hasEmailAction ? user.email : null, whatsappNumber: whatsappNumber ?? null }
})
