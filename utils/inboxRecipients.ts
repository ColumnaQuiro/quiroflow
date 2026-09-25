// Who is told about a new Inbox message. Everyone who can see the Inbox,
// unless the conversation is assigned: then only its owner, since the point
// of assigning it is that the rest of the team can stop watching it. An owner
// who can no longer sign in or see the Inbox is no owner here, and everyone
// is told as before.
export interface InboxMember {
  id: string
  user_id: string | null
  is_owner: boolean
  inbox_access: boolean
}

export function inboxRecipients(members: InboxMember[], assignedTo: string | null): string[] {
  const eligible = members.filter((m) => m.user_id && (m.is_owner || m.inbox_access))
  const owner = assignedTo ? eligible.find((m) => m.id === assignedTo) : undefined
  return (owner ? [owner] : eligible).map((m) => m.user_id as string)
}
