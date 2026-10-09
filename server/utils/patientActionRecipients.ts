// Who hears about something a patient did on their own (paid online, joined
// the waitlist -- staffPush.ts pushPatientAction): their practitioner and the
// owners, who see the clinic's money; each once. Pure, so it is tested.
export function patientActionRecipients<M extends { id: string; is_owner: boolean }>(members: M[], practitionerId: string | null): M[] {
  const seen = new Set<string>()
  return members.filter((m) => {
    if (!(m.is_owner || m.id === practitionerId) || seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}
